import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { assertRequired, cleanEmail } from '../utils.js';

const router = express.Router();
router.use(authenticate);

async function canReadList(userId, role, listId) {
  if (role === 'admin') return true;
  const result = await query(
    `SELECT rl.id
     FROM revision_lists rl
     LEFT JOIN list_shares ls ON ls.list_id = rl.id AND ls.user_id = $1
     LEFT JOIN class_members cm ON cm.class_id = rl.class_id AND cm.user_id = $1
     WHERE rl.id = $2
       AND (
        rl.owner_id = $1 OR rl.visibility = 'public' OR ls.user_id IS NOT NULL OR cm.user_id IS NOT NULL
       )`,
    [userId, listId]
  );
  return result.rowCount > 0;
}

async function canEditList(userId, role, listId) {
  if (role === 'admin') return true;
  const result = await query(
    `SELECT rl.id
     FROM revision_lists rl
     LEFT JOIN list_shares ls ON ls.list_id = rl.id AND ls.user_id = $1
     LEFT JOIN classes c ON c.id = rl.class_id
     WHERE rl.id = $2
       AND (
        rl.owner_id = $1 OR ls.can_edit = TRUE OR c.teacher_id = $1
       )`,
    [userId, listId]
  );
  return result.rowCount > 0;
}

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT rl.*, u.name AS owner_name, c.name AS class_name,
        (SELECT COUNT(*) FROM questions q WHERE q.list_id = rl.id) AS question_count
       FROM revision_lists rl
       JOIN users u ON u.id = rl.owner_id
       LEFT JOIN classes c ON c.id = rl.class_id
       LEFT JOIN list_shares ls ON ls.list_id = rl.id AND ls.user_id = $1
       LEFT JOIN class_members cm ON cm.class_id = rl.class_id AND cm.user_id = $1
       WHERE rl.owner_id = $1
          OR rl.visibility = 'public'
          OR ls.user_id IS NOT NULL
          OR cm.user_id IS NOT NULL
          OR $2 = 'admin'
       ORDER BY rl.updated_at DESC`,
      [req.user.id, req.user.role]
    );
    res.json({ lists: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    assertRequired(['title'], req.body);
    const { title, description = '', visibility = 'private', class_id = null } = req.body;

    const allowedVisibility = ['private', 'shared', 'class', 'public'].includes(visibility) ? visibility : 'private';

    if (class_id && !['teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Seul un professeur ou admin peut créer une liste de classe.' });
    }

    if (class_id && req.user.role !== 'admin') {
      const owner = await query('SELECT id FROM classes WHERE id = $1 AND teacher_id = $2', [class_id, req.user.id]);
      if (owner.rowCount === 0) return res.status(403).json({ message: 'Classe non autorisée.' });
    }

    const result = await query(
      `INSERT INTO revision_lists (title, description, owner_id, class_id, visibility)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, description, req.user.id, class_id, class_id ? 'class' : allowedVisibility]
    );
    res.status(201).json({ list: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const allowed = await canReadList(req.user.id, req.user.role, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Liste inaccessible.' });

    const listResult = await query(
      `SELECT rl.*, u.name AS owner_name, c.name AS class_name
       FROM revision_lists rl
       JOIN users u ON u.id = rl.owner_id
       LEFT JOIN classes c ON c.id = rl.class_id
       WHERE rl.id = $1`,
      [req.params.id]
    );

    const questionsResult = await query(
      `SELECT q.id AS question_id, q.question_text, q.type,
              a.id AS answer_id, a.answer_text, a.is_correct
       FROM questions q
       LEFT JOIN answers a ON a.question_id = q.id
       WHERE q.list_id = $1
       ORDER BY q.created_at ASC, a.answer_text ASC`,
      [req.params.id]
    );

    const questionsMap = new Map();
    for (const row of questionsResult.rows) {
      if (!questionsMap.has(row.question_id)) {
        questionsMap.set(row.question_id, {
          id: row.question_id,
          question_text: row.question_text,
          type: row.type,
          answers: []
        });
      }
      if (row.answer_id) {
        questionsMap.get(row.question_id).answers.push({
          id: row.answer_id,
          answer_text: row.answer_text,
          is_correct: row.is_correct
        });
      }
    }

    res.json({ list: listResult.rows[0], questions: Array.from(questionsMap.values()) });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const allowed = await canEditList(req.user.id, req.user.role, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Modification refusée.' });

    const { title, description, visibility } = req.body;
    const result = await query(
      `UPDATE revision_lists
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           visibility = COALESCE($3::list_visibility, visibility)
       WHERE id = $4
       RETURNING *`,
      [title || null, description ?? null, visibility || null, req.params.id]
    );
    res.json({ list: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const allowed = await canEditList(req.user.id, req.user.role, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Suppression refusée.' });

    await query('DELETE FROM revision_lists WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/:id/share', async (req, res, next) => {
  try {
    const allowed = await canEditList(req.user.id, req.user.role, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Partage refusé.' });
    assertRequired(['email'], req.body);

    const userResult = await query('SELECT id FROM users WHERE email = $1', [cleanEmail(req.body.email)]);
    if (userResult.rowCount === 0) return res.status(404).json({ message: 'Utilisateur introuvable.' });

    await query(
      `INSERT INTO list_shares (list_id, user_id, can_edit)
       VALUES ($1, $2, $3)
       ON CONFLICT (list_id, user_id)
       DO UPDATE SET can_edit = EXCLUDED.can_edit`,
      [req.params.id, userResult.rows[0].id, Boolean(req.body.can_edit)]
    );

    await query("UPDATE revision_lists SET visibility = 'shared' WHERE id = $1 AND visibility = 'private'", [req.params.id]);
    res.status(201).json({ message: 'Liste partagée.' });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/questions', async (req, res, next) => {
  try {
    const allowed = await canEditList(req.user.id, req.user.role, req.params.id);
    if (!allowed) return res.status(403).json({ message: 'Ajout de question refusé.' });
    assertRequired(['question_text', 'answers'], req.body);

    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    if (answers.length < 2 || !answers.some((answer) => answer.is_correct)) {
      return res.status(400).json({ message: 'Une question doit avoir au moins deux réponses, dont une correcte.' });
    }

    const qResult = await query(
      `INSERT INTO questions (list_id, question_text, type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.id, req.body.question_text, req.body.type || 'single_choice']
    );

    for (const answer of answers) {
      await query(
        `INSERT INTO answers (question_id, answer_text, is_correct)
         VALUES ($1, $2, $3)`,
        [qResult.rows[0].id, answer.answer_text, Boolean(answer.is_correct)]
      );
    }

    res.status(201).json({ question: qResult.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
