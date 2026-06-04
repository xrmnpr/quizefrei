const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function uniqueCode() {
  let code;
  do {
    code = generateCode();
  } while (await db.queryOne('SELECT 1 FROM classes WHERE invite_code = $1', [code]));
  return code;
}

router.get('/', async (req, res) => {
  const { id: userId, role } = req.user;
  try {
    let classes;
    if (role === 'teacher') {
      classes = await db.query(`
        SELECT c.*, COUNT(cm.student_id) as member_count
        FROM classes c LEFT JOIN class_members cm ON cm.class_id = c.id
        WHERE c.teacher_id = $1
        GROUP BY c.id ORDER BY c.created_at DESC
      `, [userId]);
    } else if (role === 'admin') {
      classes = await db.query(`
        SELECT c.*, u.name as teacher_name, COUNT(cm.student_id) as member_count
        FROM classes c JOIN users u ON u.id = c.teacher_id
        LEFT JOIN class_members cm ON cm.class_id = c.id
        GROUP BY c.id, u.name ORDER BY c.created_at DESC
      `);
    } else {
      classes = await db.query(`
        SELECT c.*, u.name as teacher_name, COUNT(cm2.student_id) as member_count
        FROM classes c
        JOIN class_members cm ON cm.class_id = c.id AND cm.student_id = $1
        JOIN users u ON u.id = c.teacher_id
        LEFT JOIN class_members cm2 ON cm2.class_id = c.id
        GROUP BY c.id, u.name ORDER BY c.created_at DESC
      `, [userId]);
    }
    res.json(classes.map(c => ({ ...c, member_count: Number.parseInt(c.member_count) })));
  } catch (err) {
    console.error('GET /classes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const cls = await db.queryOne(
      'SELECT c.*, u.name as teacher_name FROM classes c JOIN users u ON u.id = c.teacher_id WHERE c.id = $1',
      [req.params.id]
    );
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const { id: userId, role } = req.user;
    const isMember = await db.queryOne(
      'SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2',
      [req.params.id, userId]
    );
    if (cls.teacher_id !== userId && !isMember && role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const members = await db.query(`
      SELECT u.id, u.name, u.email, cm.joined_at FROM class_members cm
      JOIN users u ON u.id = cm.student_id WHERE cm.class_id = $1
    `, [req.params.id]);

    const lists = await db.query(`
      SELECT l.*, u.name as owner_name,
        (SELECT COUNT(*) FROM questions WHERE list_id = l.id) as question_count
      FROM class_lists cl JOIN lists l ON l.id = cl.list_id
      JOIN users u ON u.id = l.owner_id
      WHERE cl.class_id = $1
    `, [req.params.id]);

    res.json({
      ...cls,
      members,
      lists: lists.map(l => ({ ...l, question_count: Number.parseInt(l.question_count) }))
    });
  } catch (err) {
    console.error('GET /classes/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireRole('teacher', 'admin'), async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const code = await uniqueCode();
    const id = uuidv4();
    await db.query(
      'INSERT INTO classes (id, name, description, teacher_id, invite_code) VALUES ($1, $2, $3, $4, $5)',
      [id, name, description || null, req.user.id, code]
    );
    res.status(201).json(await db.queryOne('SELECT * FROM classes WHERE id = $1', [id]));
  } catch (err) {
    console.error('POST /classes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const cls = await db.queryOne('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (cls.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { name, description } = req.body;
    await db.query(
      'UPDATE classes SET name = $1, description = $2 WHERE id = $3',
      [name ?? cls.name, description !== undefined ? description : cls.description, req.params.id]
    );
    res.json(await db.queryOne('SELECT * FROM classes WHERE id = $1', [req.params.id]));
  } catch (err) {
    console.error('PUT /classes/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const cls = await db.queryOne('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (cls.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await db.query('DELETE FROM classes WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /classes/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/join', requireRole('student'), async (req, res) => {
  const { invite_code } = req.body;
  try {
    const cls = await db.queryOne('SELECT * FROM classes WHERE invite_code = $1', [invite_code?.toUpperCase()]);
    if (!cls) return res.status(404).json({ error: 'Invalid invite code' });

    const already = await db.queryOne(
      'SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2',
      [cls.id, req.user.id]
    );
    if (already) return res.status(409).json({ error: 'Already a member' });

    await db.query('INSERT INTO class_members (class_id, student_id) VALUES ($1, $2)', [cls.id, req.user.id]);
    res.json({ success: true, class: { id: cls.id, name: cls.name } });
  } catch (err) {
    console.error('POST /classes/join error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/members/:studentId', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const cls = await db.queryOne('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await db.query('DELETE FROM class_members WHERE class_id = $1 AND student_id = $2', [req.params.id, req.params.studentId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /classes/:id/members/:studentId error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/lists', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const cls = await db.queryOne('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { list_id } = req.body;
    const list = await db.queryOne('SELECT * FROM lists WHERE id = $1', [list_id]);
    if (!list) return res.status(404).json({ error: 'List not found' });

    await db.query(
      'INSERT INTO class_lists (class_id, list_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, list_id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /classes/:id/lists error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/lists/:listId', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const cls = await db.queryOne('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await db.query('DELETE FROM class_lists WHERE class_id = $1 AND list_id = $2', [req.params.id, req.params.listId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /classes/:id/lists/:listId error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/regenerate-code', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const cls = await db.queryOne('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const code = await uniqueCode();
    await db.query('UPDATE classes SET invite_code = $1 WHERE id = $2', [code, req.params.id]);
    res.json({ invite_code: code });
  } catch (err) {
    console.error('POST /classes/:id/regenerate-code error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
