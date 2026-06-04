const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// List classes for current user
router.get('/', (req, res) => {
  const { id: userId, role } = req.user;
  let classes;

  if (role === 'teacher') {
    classes = db.prepare(`
      SELECT c.*, COUNT(cm.student_id) as member_count
      FROM classes c LEFT JOIN class_members cm ON cm.class_id = c.id
      WHERE c.teacher_id = ?
      GROUP BY c.id ORDER BY c.created_at DESC
    `).all(userId);
  } else if (role === 'admin') {
    classes = db.prepare(`
      SELECT c.*, u.name as teacher_name, COUNT(cm.student_id) as member_count
      FROM classes c JOIN users u ON u.id = c.teacher_id
      LEFT JOIN class_members cm ON cm.class_id = c.id
      GROUP BY c.id ORDER BY c.created_at DESC
    `).all();
  } else {
    classes = db.prepare(`
      SELECT c.*, u.name as teacher_name, COUNT(cm2.student_id) as member_count
      FROM classes c
      JOIN class_members cm ON cm.class_id = c.id AND cm.student_id = ?
      JOIN users u ON u.id = c.teacher_id
      LEFT JOIN class_members cm2 ON cm2.class_id = c.id
      GROUP BY c.id ORDER BY c.created_at DESC
    `).all(userId);
  }

  res.json(classes);
});

// Get a single class with members and lists
router.get('/:id', (req, res) => {
  const cls = db.prepare('SELECT c.*, u.name as teacher_name FROM classes c JOIN users u ON u.id = c.teacher_id WHERE c.id = ?').get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const { id: userId, role } = req.user;
  const isMember = db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND student_id = ?').get(req.params.id, userId);
  if (cls.teacher_id !== userId && !isMember && role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const members = db.prepare(`
    SELECT u.id, u.name, u.email, cm.joined_at FROM class_members cm
    JOIN users u ON u.id = cm.student_id WHERE cm.class_id = ?
  `).all(req.params.id);

  const lists = db.prepare(`
    SELECT l.*, u.name as owner_name,
      (SELECT COUNT(*) FROM questions WHERE list_id = l.id) as question_count
    FROM class_lists cl JOIN lists l ON l.id = cl.list_id
    JOIN users u ON u.id = l.owner_id
    WHERE cl.class_id = ?
  `).all(req.params.id);

  res.json({ ...cls, members, lists });
});

// Create a class (teachers only)
router.post('/', requireRole('teacher', 'admin'), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  let code;
  do { code = generateCode(); }
  while (db.prepare('SELECT 1 FROM classes WHERE invite_code = ?').get(code));

  const id = uuidv4();
  db.prepare('INSERT INTO classes (id, name, description, teacher_id, invite_code) VALUES (?, ?, ?, ?, ?)').run(
    id, name, description || null, req.user.id, code
  );
  res.status(201).json(db.prepare('SELECT * FROM classes WHERE id = ?').get(id));
});

// Update a class
router.put('/:id', requireRole('teacher', 'admin'), (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  if (cls.teacher_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });

  const { name, description } = req.body;
  db.prepare('UPDATE classes SET name = ?, description = ? WHERE id = ?').run(
    name ?? cls.name, description !== undefined ? description : cls.description, req.params.id
  );
  res.json(db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id));
});

// Delete a class
router.delete('/:id', requireRole('teacher', 'admin'), (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  if (cls.teacher_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });

  db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Join a class by invite code (students)
router.post('/join', requireRole('student'), (req, res) => {
  const { invite_code } = req.body;
  const cls = db.prepare('SELECT * FROM classes WHERE invite_code = ?').get(invite_code?.toUpperCase());
  if (!cls) return res.status(404).json({ error: 'Invalid invite code' });

  const already = db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND student_id = ?').get(cls.id, req.user.id);
  if (already) return res.status(409).json({ error: 'Already a member' });

  db.prepare('INSERT INTO class_members (class_id, student_id) VALUES (?, ?)').run(cls.id, req.user.id);
  res.json({ success: true, class: { id: cls.id, name: cls.name } });
});

// Remove a student from a class
router.delete('/:id/members/:studentId', requireRole('teacher', 'admin'), (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'Not authorized' });

  db.prepare('DELETE FROM class_members WHERE class_id = ? AND student_id = ?').run(req.params.id, req.params.studentId);
  res.json({ success: true });
});

// Add a list to a class
router.post('/:id/lists', requireRole('teacher', 'admin'), (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'Not authorized' });

  const { list_id } = req.body;
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(list_id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  db.prepare('INSERT OR IGNORE INTO class_lists (class_id, list_id) VALUES (?, ?)').run(req.params.id, list_id);
  res.json({ success: true });
});

// Remove a list from a class
router.delete('/:id/lists/:listId', requireRole('teacher', 'admin'), (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'Not authorized' });

  db.prepare('DELETE FROM class_lists WHERE class_id = ? AND list_id = ?').run(req.params.id, req.params.listId);
  res.json({ success: true });
});

// Regenerate invite code
router.post('/:id/regenerate-code', requireRole('teacher', 'admin'), (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'Not authorized' });

  let code;
  do { code = generateCode(); }
  while (db.prepare('SELECT 1 FROM classes WHERE invite_code = ?').get(code));

  db.prepare('UPDATE classes SET invite_code = ? WHERE id = ?').run(code, req.params.id);
  res.json({ invite_code: code });
});

module.exports = router;
