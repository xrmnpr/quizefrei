import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { assertRequired, cleanEmail, makeJoinCode } from '../utils.js';

const router = express.Router();
router.use(authenticate);

async function canManageClass(user, classId) {
  if (user.role === 'admin') return true;
  const result = await query('SELECT id FROM classes WHERE id = $1 AND teacher_id = $2', [classId, user.id]);
  return result.rowCount > 0;
}

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT c.*, u.name AS teacher_name,
        (SELECT COUNT(*) FROM class_members cm WHERE cm.class_id = c.id) AS student_count
       FROM classes c
       JOIN users u ON u.id = c.teacher_id
       LEFT JOIN class_members cm ON cm.class_id = c.id
       WHERE c.teacher_id = $1 OR cm.user_id = $1 OR $2 = 'admin'
       ORDER BY c.created_at DESC`,
      [req.user.id, req.user.role]
    );
    res.json({ classes: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    assertRequired(['name'], req.body);
    const result = await query(
      `INSERT INTO classes (name, description, teacher_id, join_code)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.body.name, req.body.description || '', req.user.id, makeJoinCode()]
    );
    res.status(201).json({ class: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/join', requireRole('student', 'teacher', 'admin'), async (req, res, next) => {
  try {
    assertRequired(['join_code'], req.body);
    const classResult = await query('SELECT id FROM classes WHERE join_code = $1', [String(req.body.join_code).trim().toUpperCase()]);
    if (classResult.rowCount === 0) return res.status(404).json({ message: 'Code de classe invalide.' });

    await query(
      `INSERT INTO class_members (class_id, user_id, member_role)
       VALUES ($1, $2, $3)
       ON CONFLICT (class_id, user_id) DO NOTHING`,
      [classResult.rows[0].id, req.user.id, req.user.role]
    );
    res.status(201).json({ message: 'Classe rejointe.' });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/students', async (req, res, next) => {
  try {
    const allowed = await canManageClass(req.user, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Accès refusé.' });

    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, cm.joined_at
       FROM class_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.class_id = $1
       ORDER BY u.name ASC`,
      [req.params.id]
    );
    res.json({ students: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/invite', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const allowed = await canManageClass(req.user, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Invitation refusée.' });
    assertRequired(['email'], req.body);

    const userResult = await query('SELECT id, role FROM users WHERE email = $1', [cleanEmail(req.body.email)]);
    if (userResult.rowCount === 0) return res.status(404).json({ message: 'Utilisateur introuvable.' });

    await query(
      `INSERT INTO class_members (class_id, user_id, member_role)
       VALUES ($1, $2, $3)
       ON CONFLICT (class_id, user_id) DO NOTHING`,
      [req.params.id, userResult.rows[0].id, userResult.rows[0].role]
    );
    res.status(201).json({ message: 'Étudiant ajouté à la classe.' });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/evaluations', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const allowed = await canManageClass(req.user, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Création d’évaluation refusée.' });
    assertRequired(['list_id', 'title', 'time_limit_seconds'], req.body);

    const listResult = await query('SELECT id FROM revision_lists WHERE id = $1 AND class_id = $2', [req.body.list_id, req.params.id]);
    if (listResult.rowCount === 0) return res.status(400).json({ message: 'La liste doit appartenir à cette classe.' });

    const result = await query(
      `INSERT INTO evaluations (class_id, list_id, title, time_limit_seconds, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.params.id, req.body.list_id, req.body.title, req.body.time_limit_seconds, req.body.starts_at || null, req.body.ends_at || null, req.user.id]
    );
    res.status(201).json({ evaluation: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/evaluations', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT e.*, rl.title AS list_title
       FROM evaluations e
       JOIN revision_lists rl ON rl.id = e.list_id
       LEFT JOIN class_members cm ON cm.class_id = e.class_id AND cm.user_id = $2
       LEFT JOIN classes c ON c.id = e.class_id
       WHERE e.class_id = $1 AND (cm.user_id IS NOT NULL OR c.teacher_id = $2 OR $3 = 'admin')
       ORDER BY e.created_at DESC`,
      [req.params.id, req.user.id, req.user.role]
    );
    res.json({ evaluations: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/results', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const allowed = await canManageClass(req.user, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Accès refusé.' });

    const result = await query(
      `SELECT qs.id, qs.score, qs.total_questions, qs.started_at, qs.submitted_at,
              u.name AS student_name, u.email, e.title AS evaluation_title, rl.title AS list_title
       FROM quiz_sessions qs
       JOIN users u ON u.id = qs.user_id
       JOIN revision_lists rl ON rl.id = qs.list_id
       LEFT JOIN evaluations e ON e.id = qs.evaluation_id
       WHERE rl.class_id = $1 AND qs.graded = TRUE
       ORDER BY qs.submitted_at DESC NULLS LAST`,
      [req.params.id]
    );
    res.json({ results: result.rows });
  } catch (error) {
    next(error);
  }
});

export default router;
