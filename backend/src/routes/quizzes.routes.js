import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { assertRequired } from '../utils.js';

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
       AND (rl.owner_id = $1 OR rl.visibility = 'public' OR ls.user_id IS NOT NULL OR cm.user_id IS NOT NULL)`,
    [userId, listId]
  );
  return result.rowCount > 0;
}

async function buildQuizPayload(listId, includeCorrect = false) {
  const rows = await query(
    `SELECT q.id AS question_id, q.question_text, q.type,
            a.id AS answer_id, a.answer_text, a.is_correct
     FROM questions q
     JOIN answers a ON a.question_id = q.id
     WHERE q.list_id = $1
     ORDER BY q.created_at ASC, random()`,
    [listId]
  );

  const questions = new Map();
  for (const row of rows.rows) {
    if (!questions.has(row.question_id)) {
      questions.set(row.question_id, {
        id: row.question_id,
        question_text: row.question_text,
        type: row.type,
        answers: []
      });
    }
    const answer = { id: row.answer_id, answer_text: row.answer_text };
    if (includeCorrect) answer.is_correct = row.is_correct;
    questions.get(row.question_id).answers.push(answer);
  }

  return Array.from(questions.values());
}

router.post('/sessions', async (req, res, next) => {
  try {
    assertRequired(['list_id'], req.body);
    const allowed = await canReadList(req.user.id, req.user.role, req.body.list_id);
    if (!allowed) return res.status(403).json({ message: 'Liste inaccessible.' });

    let graded = Boolean(req.body.graded);
    let evaluationId = req.body.evaluation_id || null;
    let listId = req.body.list_id;
    let timeLimit = Number(req.body.time_limit_seconds || 600);

    if (evaluationId) {
      const evaluation = await query(
        `SELECT e.*, cm.user_id
         FROM evaluations e
         LEFT JOIN class_members cm ON cm.class_id = e.class_id AND cm.user_id = $1
         WHERE e.id = $2`,
        [req.user.id, evaluationId]
      );
      if (evaluation.rowCount === 0 || (!evaluation.rows[0].user_id && req.user.role !== 'admin')) {
        return res.status(403).json({ message: 'Évaluation inaccessible.' });
      }
      graded = true;
      listId = evaluation.rows[0].list_id;
      timeLimit = evaluation.rows[0].time_limit_seconds;
    }

    const count = await query('SELECT COUNT(*)::int AS total FROM questions WHERE list_id = $1', [listId]);
    if (count.rows[0].total === 0) return res.status(400).json({ message: 'Cette liste ne contient aucune question.' });

    const session = await query(
      `INSERT INTO quiz_sessions (user_id, list_id, evaluation_id, graded, time_limit_seconds, total_questions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, listId, evaluationId, graded, timeLimit, count.rows[0].total]
    );

    const questions = await buildQuizPayload(listId, false);
    res.status(201).json({ session: session.rows[0], questions });
  } catch (error) {
    next(error);
  }
});

router.post('/sessions/:id/submit', async (req, res, next) => {
  try {
    assertRequired(['answers'], req.body);

    const sessionResult = await query(
      'SELECT * FROM quiz_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (sessionResult.rowCount === 0) return res.status(404).json({ message: 'Session introuvable.' });

    const session = sessionResult.rows[0];
    if (session.submitted_at) return res.status(400).json({ message: 'Session déjà soumise.' });

    const elapsedResult = await query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - started_at))::int AS elapsed
       FROM quiz_sessions WHERE id = $1`,
      [req.params.id]
    );
    if (elapsedResult.rows[0].elapsed > session.time_limit_seconds + 5) {
      return res.status(400).json({ message: 'Temps dépassé. Session non soumise.' });
    }

    const submitted = Array.isArray(req.body.answers) ? req.body.answers : [];
    let score = 0;

    for (const item of submitted) {
      const correctResult = await query(
        `SELECT a.id, a.is_correct
         FROM answers a
         JOIN questions q ON q.id = a.question_id
         WHERE a.id = $1 AND q.id = $2 AND q.list_id = $3`,
        [item.answer_id, item.question_id, session.list_id]
      );
      if (correctResult.rowCount === 0) continue;

      const isCorrect = Boolean(correctResult.rows[0].is_correct);
      if (isCorrect) score += 1;

      await query(
        `INSERT INTO quiz_session_answers (session_id, question_id, answer_id, is_correct)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [req.params.id, item.question_id, item.answer_id, isCorrect]
      );
    }

    const update = await query(
      `UPDATE quiz_sessions
       SET submitted_at = NOW(), score = $1
       WHERE id = $2
       RETURNING *`,
      [score, req.params.id]
    );

    const correction = await buildQuizPayload(session.list_id, true);
    res.json({ session: update.rows[0], correction });
  } catch (error) {
    next(error);
  }
});

router.get('/sessions/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT qs.*, rl.title AS list_title, e.title AS evaluation_title
       FROM quiz_sessions qs
       JOIN revision_lists rl ON rl.id = qs.list_id
       LEFT JOIN evaluations e ON e.id = qs.evaluation_id
       WHERE qs.id = $1 AND (qs.user_id = $2 OR $3 IN ('teacher', 'admin'))`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Session introuvable.' });
    res.json({ session: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
