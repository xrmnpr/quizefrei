const express = require('express');
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/stats', async (req, res) => {
  try {
    const [users, students, teachers, lists, classes, sessions, completed] = await Promise.all([
      db.queryOne('SELECT COUNT(*) as c FROM users'),
      db.queryOne("SELECT COUNT(*) as c FROM users WHERE role = 'student'"),
      db.queryOne("SELECT COUNT(*) as c FROM users WHERE role = 'teacher'"),
      db.queryOne('SELECT COUNT(*) as c FROM lists'),
      db.queryOne('SELECT COUNT(*) as c FROM classes'),
      db.queryOne('SELECT COUNT(*) as c FROM quiz_sessions'),
      db.queryOne('SELECT COUNT(*) as c FROM quiz_sessions WHERE completed_at IS NOT NULL')
    ]);
    res.json({
      users: Number.parseInt(users.c),
      students: Number.parseInt(students.c),
      teachers: Number.parseInt(teachers.c),
      lists: Number.parseInt(lists.c),
      classes: Number.parseInt(classes.c),
      sessions: Number.parseInt(sessions.c),
      completed_sessions: Number.parseInt(completed.c)
    });
  } catch (err) {
    console.error('GET /admin/stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await db.query('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (err) {
    console.error('GET /admin/users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['student', 'teacher', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /admin/users/:id/role error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/users/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
