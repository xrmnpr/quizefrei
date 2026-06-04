const express = require('express');
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/stats', (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    students: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'student'").get().c,
    teachers: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'teacher'").get().c,
    lists: db.prepare('SELECT COUNT(*) as c FROM lists').get().c,
    classes: db.prepare('SELECT COUNT(*) as c FROM classes').get().c,
    sessions: db.prepare('SELECT COUNT(*) as c FROM quiz_sessions').get().c,
    completed_sessions: db.prepare('SELECT COUNT(*) as c FROM quiz_sessions WHERE completed_at IS NOT NULL').get().c
  });
});

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['student', 'teacher', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ success: true });
});

router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
