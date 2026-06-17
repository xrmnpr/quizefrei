const express = require('express');
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/stats', async (req, res) => {
  try {
    const [users, students, teachers, lists, classes, sessions, completed] = await Promise.all([
      db.queryOne("SELECT COUNT(*) AS c FROM users"),
      db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role='student'"),
      db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role='teacher'"),
      db.queryOne("SELECT COUNT(*) AS c FROM lists"),
      db.queryOne("SELECT COUNT(*) AS c FROM classes"),
      db.queryOne("SELECT COUNT(*) AS c FROM quiz_sessions"),
      db.queryOne("SELECT COUNT(*) AS c FROM quiz_sessions WHERE completed_at IS NOT NULL")
    ]);
    res.json({
      users:             Number(users.c),
      students:          Number(students.c),
      teachers:          Number(teachers.c),
      lists:             Number(lists.c),
      classes:           Number(classes.c),
      sessions:          Number(sessions.c),
      completed_sessions:Number(completed.c)
    });
  } catch (err) {
    console.error('GET /admin/stats:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    res.json(await db.query('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC'));
  } catch (err) {
    console.error('GET /admin/users:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['student', 'teacher', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    await db.query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /admin/users/:id/role:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    res.json(await db.query(`
      SELECT qs.*, u.name AS student_name, u.email AS student_email,
        l.title AS list_title, c.name AS class_name
      FROM quiz_sessions qs
      JOIN users u ON u.id = qs.user_id
      JOIN lists l ON l.id = qs.list_id
      LEFT JOIN classes c ON c.id = qs.class_id
      ORDER BY qs.started_at DESC
    `));
  } catch (err) {
    console.error('GET /admin/sessions:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    await db.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/users/:id:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
