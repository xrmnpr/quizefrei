const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// All lists accessible to the current user
router.get('/', async (req, res) => {
  const { id: userId, role } = req.user;
  try {
    let lists;
    if (role === 'admin') {
      lists = await db.query(`
        SELECT l.*, u.name AS owner_name
        FROM lists l JOIN users u ON u.id = l.owner_id
        ORDER BY l.created_at DESC
      `);
    } else {
      lists = await db.query(`
        SELECT DISTINCT l.*, u.name AS owner_name, (l.owner_id = $1) AS is_mine
        FROM lists l JOIN users u ON u.id = l.owner_id
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

    // Attach question count
    const withCounts = await Promise.all(lists.map(async l => {
      const row = await db.queryOne('SELECT COUNT(*) AS c FROM questions WHERE list_id = $1', [l.id]);
      return { ...l, question_count: Number(row.c) };
    }));
    res.json(withCounts);
  } catch (err) {
    console.error('GET /lists:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Only my lists
router.get('/mine', async (req, res) => {
  try {
    const lists = await db.query(`
      SELECT l.*, u.name AS owner_name,
        (SELECT COUNT(*) FROM questions WHERE list_id = l.id) AS question_count
      FROM lists l JOIN users u ON u.id = l.owner_id
      WHERE l.owner_id = $1
      ORDER BY l.created_at DESC
    `, [req.user.id]);
    res.json(lists.map(l => ({ ...l, question_count: Number(l.question_count) })));
  } catch (err) {
    console.error('GET /lists/mine:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Single list with questions + choices
router.get('/:id', async (req, res) => {
  try {
    const list = await db.queryOne(
      'SELECT l.*, u.name AS owner_name FROM lists l JOIN users u ON u.id = l.owner_id WHERE l.id = $1',
      [req.params.id]
    );
    if (!list) return res.status(404).json({ error: 'List not found' });

    const { id: userId, role } = req.user;
    const shareRow  = await db.queryOne('SELECT 1 FROM list_shares WHERE list_id = $1 AND shared_with_id = $2', [req.params.id, userId]);
    const classRow  = await db.queryOne(`
      SELECT 1 FROM class_lists cl
      JOIN class_members cm ON cm.class_id = cl.class_id
      WHERE cl.list_id = $1 AND cm.student_id = $2
    `, [req.params.id, userId]);

    if (role !== 'admin' && list.owner_id !== userId && !list.is_public && !shareRow && !classRow) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const questions = await db.query('SELECT * FROM questions WHERE list_id = $1 ORDER BY order_index', [req.params.id]);
    const questionsWithChoices = await Promise.all(questions.map(async q => ({
      ...q,
      choices: await db.query('SELECT * FROM choices WHERE question_id = $1', [q.id])
    })));

    res.json({ ...list, questions: questionsWithChoices });
  } catch (err) {
    console.error('GET /lists/:id:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create list
router.post('/', async (req, res) => {
  const { title, description, is_public, time_limit } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const id = uuidv4();
    const tl = time_limit ? Number(time_limit) : null;
    await db.query(
      'INSERT INTO lists (id, title, description, owner_id, is_public, time_limit) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, title, description || null, req.user.id, !!is_public, tl]
    );
    res.status(201).json(await db.queryOne('SELECT * FROM lists WHERE id = $1', [id]));
  } catch (err) {
    console.error('POST /lists:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update list
router.put('/:id', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (list.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });

    const { title, description, is_public, time_limit } = req.body;
    const tl = time_limit !== undefined ? (time_limit ? Number(time_limit) : null) : list.time_limit;
    await db.query('UPDATE lists SET title=$1, description=$2, is_public=$3, time_limit=$4 WHERE id=$5', [
      title ?? list.title,
      description !== undefined ? description : list.description,
      is_public !== undefined ? !!is_public : list.is_public,
      tl,
      req.params.id
    ]);
    res.json(await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]));
  } catch (err) {
    console.error('PUT /lists/:id:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete list
router.delete('/:id', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (list.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
    await db.query('DELETE FROM lists WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /lists/:id:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add question
router.post('/:id/questions', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (list.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });

    const { question_text, question_type, choices } = req.body;
    if (!question_text || !question_type) return res.status(400).json({ error: 'question_text and question_type are required' });

    const maxRow = await db.queryOne('SELECT COALESCE(MAX(order_index),-1) AS m FROM questions WHERE list_id = $1', [req.params.id]);
    const orderIndex = Number(maxRow.m) + 1;

    const qId = uuidv4();
    await db.query(
      'INSERT INTO questions (id, list_id, question_text, question_type, order_index) VALUES ($1,$2,$3,$4,$5)',
      [qId, req.params.id, question_text, question_type, orderIndex]
    );

    if (Array.isArray(choices)) {
      for (const c of choices) {
        await db.query('INSERT INTO choices (id, question_id, choice_text, is_correct) VALUES ($1,$2,$3,$4)', [uuidv4(), qId, c.choice_text, !!c.is_correct]);
      }
    }

    const question = await db.queryOne('SELECT * FROM questions WHERE id = $1', [qId]);
    question.choices = await db.query('SELECT * FROM choices WHERE question_id = $1', [qId]);
    res.status(201).json(question);
  } catch (err) {
    console.error('POST /lists/:id/questions:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update question
router.put('/:listId/questions/:questionId', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.listId]);
    if (!list || (list.owner_id !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'Not authorized' });

    const { question_text, question_type, choices } = req.body;
    await db.query('UPDATE questions SET question_text=$1, question_type=$2 WHERE id=$3 AND list_id=$4', [question_text, question_type, req.params.questionId, req.params.listId]);

    if (choices) {
      await db.query('DELETE FROM choices WHERE question_id = $1', [req.params.questionId]);
      for (const c of choices) {
        await db.query('INSERT INTO choices (id, question_id, choice_text, is_correct) VALUES ($1,$2,$3,$4)', [uuidv4(), req.params.questionId, c.choice_text, !!c.is_correct]);
      }
    }

    const question = await db.queryOne('SELECT * FROM questions WHERE id = $1', [req.params.questionId]);
    if (question) question.choices = await db.query('SELECT * FROM choices WHERE question_id = $1', [req.params.questionId]);
    res.json(question);
  } catch (err) {
    console.error('PUT question:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete question
router.delete('/:listId/questions/:questionId', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.listId]);
    if (!list || (list.owner_id !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'Not authorized' });
    await db.query('DELETE FROM questions WHERE id=$1 AND list_id=$2', [req.params.questionId, req.params.listId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE question:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Share with a user by email
router.post('/:id/share', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [req.params.id]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const target = await db.queryOne('SELECT id, name, email FROM users WHERE email = $1', [req.body.email?.toLowerCase()]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot share with yourself' });

    await db.query('INSERT INTO list_shares (list_id, shared_with_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, target.id]);
    res.json({ success: true, shared_with: target });
  } catch (err) {
    console.error('POST /share:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// List shares
router.get('/:id/shares', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT owner_id FROM lists WHERE id = $1', [req.params.id]);
    if (!list || list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    const shares = await db.query('SELECT u.id, u.name, u.email FROM list_shares ls JOIN users u ON u.id = ls.shared_with_id WHERE ls.list_id = $1', [req.params.id]);
    res.json(shares);
  } catch (err) {
    console.error('GET /shares:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a share
router.delete('/:id/share/:userId', async (req, res) => {
  try {
    const list = await db.queryOne('SELECT owner_id FROM lists WHERE id = $1', [req.params.id]);
    if (!list || list.owner_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    await db.query('DELETE FROM list_shares WHERE list_id=$1 AND shared_with_id=$2', [req.params.id, req.params.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /share/:userId:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
