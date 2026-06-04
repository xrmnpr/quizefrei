const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Get all lists accessible to the current user
router.get('/', (req, res) => {
  const { id: userId, role } = req.user;
  let lists;

  if (role === 'admin') {
    lists = db.prepare(`
      SELECT l.*, u.name as owner_name FROM lists l
      JOIN users u ON u.id = l.owner_id
      ORDER BY l.created_at DESC
    `).all();
  } else {
    lists = db.prepare(`
      SELECT DISTINCT l.*, u.name as owner_name,
        CASE WHEN l.owner_id = ? THEN 1 ELSE 0 END as is_mine
      FROM lists l
      JOIN users u ON u.id = l.owner_id
      WHERE l.owner_id = ?
        OR l.is_public = 1
        OR EXISTS (SELECT 1 FROM list_shares ls WHERE ls.list_id = l.id AND ls.shared_with_id = ?)
        OR EXISTS (
          SELECT 1 FROM class_lists cl
          JOIN class_members cm ON cm.class_id = cl.class_id
          WHERE cl.list_id = l.id AND cm.student_id = ?
        )
      ORDER BY l.created_at DESC
    `).all(userId, userId, userId, userId);
  }

  const withCounts = lists.map(l => ({
    ...l,
    question_count: db.prepare('SELECT COUNT(*) as c FROM questions WHERE list_id = ?').get(l.id).c
  }));

  res.json(withCounts);
});

// Get my lists only
router.get('/mine', (req, res) => {
  const lists = db.prepare(`
    SELECT l.*, u.name as owner_name,
      (SELECT COUNT(*) FROM questions WHERE list_id = l.id) as question_count
    FROM lists l JOIN users u ON u.id = l.owner_id
    WHERE l.owner_id = ?
    ORDER BY l.created_at DESC
  `).all(req.user.id);
  res.json(lists);
});

// Get a single list with its questions and choices
router.get('/:id', (req, res) => {
  const list = db.prepare('SELECT l.*, u.name as owner_name FROM lists l JOIN users u ON u.id = l.owner_id WHERE l.id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const { id: userId, role } = req.user;
  const canAccess =
    role === 'admin' ||
    list.owner_id === userId ||
    list.is_public ||
    db.prepare('SELECT 1 FROM list_shares WHERE list_id = ? AND shared_with_id = ?').get(req.params.id, userId) ||
    db.prepare(`
      SELECT 1 FROM class_lists cl JOIN class_members cm ON cm.class_id = cl.class_id
      WHERE cl.list_id = ? AND cm.student_id = ?
    `).get(req.params.id, userId);

  if (!canAccess) return res.status(403).json({ error: 'Access denied' });

  const questions = db.prepare('SELECT * FROM questions WHERE list_id = ? ORDER BY order_index').all(req.params.id);
  const questionsWithChoices = questions.map(q => ({
    ...q,
    choices: db.prepare('SELECT * FROM choices WHERE question_id = ?').all(q.id)
  }));

  res.json({ ...list, questions: questionsWithChoices });
});

// Create a list
router.post('/', (req, res) => {
  const { title, description, is_public } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const id = uuidv4();
  db.prepare('INSERT INTO lists (id, title, description, owner_id, is_public) VALUES (?, ?, ?, ?, ?)').run(
    id, title, description || null, req.user.id, is_public ? 1 : 0
  );
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  res.status(201).json(list);
});

// Update a list
router.put('/:id', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  if (list.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { title, description, is_public } = req.body;
  db.prepare('UPDATE lists SET title = ?, description = ?, is_public = ? WHERE id = ?').run(
    title ?? list.title,
    description !== undefined ? description : list.description,
    is_public !== undefined ? (is_public ? 1 : 0) : list.is_public,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id));
});

// Delete a list
router.delete('/:id', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  if (list.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  db.prepare('DELETE FROM lists WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Add a question to a list
router.post('/:id/questions', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  if (list.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { question_text, question_type, choices } = req.body;
  if (!question_text || !question_type) {
    return res.status(400).json({ error: 'question_text and question_type are required' });
  }

  const maxOrder = db.prepare('SELECT MAX(order_index) as m FROM questions WHERE list_id = ?').get(req.params.id);
  const orderIndex = (maxOrder.m ?? -1) + 1;

  const qId = uuidv4();
  db.prepare('INSERT INTO questions (id, list_id, question_text, question_type, order_index) VALUES (?, ?, ?, ?, ?)').run(
    qId, req.params.id, question_text, question_type, orderIndex
  );

  if (choices && Array.isArray(choices)) {
    for (const c of choices) {
      db.prepare('INSERT INTO choices (id, question_id, choice_text, is_correct) VALUES (?, ?, ?, ?)').run(
        uuidv4(), qId, c.choice_text, c.is_correct ? 1 : 0
      );
    }
  }

  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(qId);
  question.choices = db.prepare('SELECT * FROM choices WHERE question_id = ?').all(qId);
  res.status(201).json(question);
});

// Update a question
router.put('/:listId/questions/:questionId', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.listId);
  if (!list || (list.owner_id !== req.user.id && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { question_text, question_type, choices } = req.body;
  db.prepare('UPDATE questions SET question_text = ?, question_type = ? WHERE id = ? AND list_id = ?').run(
    question_text, question_type, req.params.questionId, req.params.listId
  );

  if (choices) {
    db.prepare('DELETE FROM choices WHERE question_id = ?').run(req.params.questionId);
    for (const c of choices) {
      db.prepare('INSERT INTO choices (id, question_id, choice_text, is_correct) VALUES (?, ?, ?, ?)').run(
        uuidv4(), req.params.questionId, c.choice_text, c.is_correct ? 1 : 0
      );
    }
  }

  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.questionId);
  if (question) question.choices = db.prepare('SELECT * FROM choices WHERE question_id = ?').all(req.params.questionId);
  res.json(question);
});

// Delete a question
router.delete('/:listId/questions/:questionId', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.listId);
  if (!list || (list.owner_id !== req.user.id && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  db.prepare('DELETE FROM questions WHERE id = ? AND list_id = ?').run(req.params.questionId, req.params.listId);
  res.json({ success: true });
});

// Share a list with a user by email
router.post('/:id/share', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  if (list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

  const { email } = req.body;
  const target = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email?.toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot share with yourself' });

  db.prepare('INSERT OR IGNORE INTO list_shares (list_id, shared_with_id) VALUES (?, ?)').run(req.params.id, target.id);
  res.json({ success: true, shared_with: { id: target.id, name: target.name, email: target.email } });
});

// Get shared users for a list
router.get('/:id/shares', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list || list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

  const shares = db.prepare(`
    SELECT u.id, u.name, u.email FROM list_shares ls
    JOIN users u ON u.id = ls.shared_with_id
    WHERE ls.list_id = ?
  `).all(req.params.id);
  res.json(shares);
});

// Remove a share
router.delete('/:id/share/:userId', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list || list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM list_shares WHERE list_id = ? AND shared_with_id = ?').run(req.params.id, req.params.userId);
  res.json({ success: true });
});

module.exports = router;
