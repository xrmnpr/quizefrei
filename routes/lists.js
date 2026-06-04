const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const { id: userId, role } = req.user;
  try {
    let lists;
    if (role === 'admin') {
      lists = await db.query(`
        SELECT l.*, u.name as owner_name FROM lists l
        JOIN users u ON u.id = l.owner_id
        ORDER BY l.created_at DESC
      `);
    } else {
      lists = await db.query(`
        SELECT DISTINCT l.*, u.name as owner_name,
          (l.owner_id = $1) as is_mine
        FROM lists l
        JOIN users u ON u.id = l.owner_id
        WHERE l.owner_id = $2
          OR l.is_public = TRUE
          OR EXISTS (SELECT 1 FROM list_shares ls WHERE ls.list_id = l.id AND ls.shared_with_id = $3)
          OR EXISTS (
            SELECT 1 FROM class_lists cl
            JOIN class_members cm ON cm.class_id = cl.class_id
            WHERE cl.list_id = l.id AND cm.student_id = $4
          )
        ORDER BY l.created_at DESC
      `, [userId, userId, userId, userId]);
    }

    const withCounts = await Promise.all(lists.map(async l => {
      const row = await db.queryOne('SELECT COUNT(*) as c FROM questions WHERE list_id = $1', [l.id]);
      return { ...l, question_count: Number.parseInt(row.c) };
    }));

    res.json(withCounts);
  } catch (err) {
    console.error('GET /lists error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/mine', async (req, res) => {
  try {
    const lists = await db.query(`
      SELECT l.*, u.name as owner_name,
        (SELECT COUNT(*) FROM questions WHERE list_id = l.id) as question_count
      FROM lists l JOIN users u ON u.id = l.owner_id
      WHERE l.owner_id = $1
      ORDER BY l.created_at DESC
    `, [req.user.id]);
    res.json(lists.map(l => ({ ...l, question_count: Number.parseInt(l.question_count) })));
  } catch (err) {
    console.error('GET /lists/mine error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const list = await db.queryOne(
      'SELECT l.*, u.name as owner_name FROM lists l JOIN users u ON u.id = l.owner_id WHERE l.id = $1',
      [req.params.id]
    );
    if (!list) return res.status(404).json({ error: 'List not found' });

    const { id: userId, role } = req.user;
    const shareCheck = await db.queryOne(
      'SELECT 1 FROM list_shares WHERE list_id = $1 AND shared_with_id = $2',
      [req.params.id, userId]
    );
    const classCheck = await db.queryOne(`
      SELECT 1 FROM class_lists cl JOIN class_members cm ON cm.class_id = cl.class_id
      WHERE cl.list_id = $1 AND cm.student_id = $2
    `, [req.params.id, userId]);

    const canAccess = role === 'admin' || list.owner_id === userId || list.is_public || shareCheck || classCheck;
    if (!canAccess) return res.status(403).json({ error: 'Access denied' });

    const questions = await db.query(
      'SELECT * FROM questions WHERE list_id = $1 ORDER BY order_index',
      [req.params.id]
    );
    const questionsWithChoices = await Promise.all(questions.map(async q => ({
      ...q,
      choices: await db.query('SELECT * FROM choices WHERE question_id = $1', [q.id])
    })));

    res.json({ ...list, questions: questionsWithChoices });
  } catch (err) {
    console.error('GET /lists/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  const { title, description, is_public } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const id = uuidv4();
    await db.query(
      'INSERT INTO lists (id, title, description, owner_id, is_public) VALUES ($1, $2, $3, $4, $5)',
      [id, title, description || null, req.user.id, !!is_public]
    );
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [id]);
    res.status(201).json(list);
  } catch (err) {
    console.error('POST /lists error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (list.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { title, description, is_public } = req.body;
    await db.query(
      'UPDATE lists SET title = $1, description = $2, is_public = $3 WHERE id = $4',
      [
        title ?? list.title,
        description !== undefined ? description : list.description,
        is_public !== undefined ? !!is_public : list.is_public,
        req.params.id
      ]
    );
    res.json(await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]));
  } catch (err) {
    console.error('PUT /lists/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (list.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await db.query('DELETE FROM lists WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /lists/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/questions', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (list.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { question_text, question_type, choices } = req.body;
    if (!question_text || !question_type) {
      return res.status(400).json({ error: 'question_text and question_type are required' });
    }

    const maxRow = await db.queryOne(
      'SELECT COALESCE(MAX(order_index), -1) as m FROM questions WHERE list_id = $1',
      [req.params.id]
    );
    const orderIndex = Number.parseInt(maxRow.m) + 1;

    const qId = uuidv4();
    await db.query(
      'INSERT INTO questions (id, list_id, question_text, question_type, order_index) VALUES ($1, $2, $3, $4, $5)',
      [qId, req.params.id, question_text, question_type, orderIndex]
    );

    if (Array.isArray(choices)) {
      for (const c of choices) {
        await db.query(
          'INSERT INTO choices (id, question_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)',
          [uuidv4(), qId, c.choice_text, !!c.is_correct]
        );
      }
    }

    const question = await db.queryOne('SELECT * FROM questions WHERE id = $1', [qId]);
    question.choices = await db.query('SELECT * FROM choices WHERE question_id = $1', [qId]);
    res.status(201).json(question);
  } catch (err) {
    console.error('POST /lists/:id/questions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:listId/questions/:questionId', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.listId]);
    if (!list || (list.owner_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { question_text, question_type, choices } = req.body;
    await db.query(
      'UPDATE questions SET question_text = $1, question_type = $2 WHERE id = $3 AND list_id = $4',
      [question_text, question_type, req.params.questionId, req.params.listId]
    );

    if (choices) {
      await db.query('DELETE FROM choices WHERE question_id = $1', [req.params.questionId]);
      for (const c of choices) {
        await db.query(
          'INSERT INTO choices (id, question_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)',
          [uuidv4(), req.params.questionId, c.choice_text, !!c.is_correct]
        );
      }
    }

    const question = await db.queryOne('SELECT * FROM questions WHERE id = $1', [req.params.questionId]);
    if (question) question.choices = await db.query('SELECT * FROM choices WHERE question_id = $1', [req.params.questionId]);
    res.json(question);
  } catch (err) {
    console.error('PUT /lists/:listId/questions/:questionId error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:listId/questions/:questionId', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.listId]);
    if (!list || (list.owner_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await db.query('DELETE FROM questions WHERE id = $1 AND list_id = $2', [req.params.questionId, req.params.listId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE question error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/share', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const { email } = req.body;
    const target = await db.queryOne('SELECT id, name, email FROM users WHERE email = $1', [email?.toLowerCase()]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot share with yourself' });

    await db.query(
      'INSERT INTO list_shares (list_id, shared_with_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, target.id]
    );
    res.json({ success: true, shared_with: { id: target.id, name: target.name, email: target.email } });
  } catch (err) {
    console.error('POST /share error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/shares', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list || list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const shares = await db.query(`
      SELECT u.id, u.name, u.email FROM list_shares ls
      JOIN users u ON u.id = ls.shared_with_id
      WHERE ls.list_id = $1
    `, [req.params.id]);
    res.json(shares);
  } catch (err) {
    console.error('GET /shares error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/share/:userId', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list || list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    await db.query('DELETE FROM list_shares WHERE list_id = $1 AND shared_with_id = $2', [req.params.id, req.params.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /share/:userId error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
