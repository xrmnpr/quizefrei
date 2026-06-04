const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Grade a single response — extracted to keep the submit handler simple
async function gradeResponse(question, r) {
  if (question.question_type === 'short_answer') return { choiceId: null, isCorrect: null };
  const choiceId = r.choice_id || null;
  if (!choiceId) return { choiceId: null, isCorrect: false };
  const choice = await db.queryOne('SELECT is_correct FROM choices WHERE id=$1 AND question_id=$2', [choiceId, question.id]);
  return { choiceId, isCorrect: choice ? choice.is_correct : false };
}

// Start a session
router.post('/start', async (req, res) => {
  const { list_id, class_id, time_limit, is_graded } = req.body;
  if (!list_id) return res.status(400).json({ error: 'list_id is required' });
  try {
    const list = await db.queryOne('SELECT * FROM lists WHERE id=$1', [list_id]);
    if (!list) return res.status(404).json({ error: 'List not found' });

    const questions = await db.query('SELECT * FROM questions WHERE list_id=$1 ORDER BY order_index', [list_id]);
    if (!questions.length) return res.status(400).json({ error: 'List has no questions' });

    if (is_graded && req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only teachers can create graded sessions' });
    }

    const id = uuidv4();
    await db.query(
      'INSERT INTO quiz_sessions (id,list_id,user_id,class_id,time_limit,total_questions,is_graded) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, list_id, req.user.id, class_id || null, time_limit || null, questions.length, !!is_graded]
    );

    const questionsWithChoices = await Promise.all(questions.map(async q => ({
      ...q,
      choices: await db.query('SELECT id, choice_text FROM choices WHERE question_id=$1', [q.id])
    })));

    res.status(201).json({ session_id: id, list_title: list.title, time_limit: time_limit || null, questions: questionsWithChoices });
  } catch (err) {
    console.error('POST /sessions/start:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit answers and complete session
router.post('/:id/submit', async (req, res) => {
  try {
    const session = await db.queryOne('SELECT * FROM quiz_sessions WHERE id=$1', [req.params.id]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (session.completed_at) return res.status(400).json({ error: 'Session already completed' });

    const { responses } = req.body;
    if (!Array.isArray(responses)) return res.status(400).json({ error: 'responses must be an array' });

    const allQuestions = await db.query('SELECT * FROM questions WHERE list_id=$1', [session.list_id]);
    const byId = Object.fromEntries(allQuestions.map(q => [q.id, q]));

    let correct = 0;
    let autoCount = 0;

    for (const r of responses) {
      const question = byId[r.question_id];
      if (!question) continue;

      const { choiceId, isCorrect } = await gradeResponse(question, r);

      if (question.question_type !== 'short_answer') {
        autoCount++;
        if (isCorrect) correct++;
      }

      await db.query(
        'INSERT INTO quiz_responses (id,session_id,question_id,choice_id,text_answer,is_correct) VALUES ($1,$2,$3,$4,$5,$6)',
        [uuidv4(), session.id, question.id, choiceId, r.text_answer || null, isCorrect]
      );
    }

    const score = autoCount > 0 ? Math.round((correct / session.total_questions) * 100) : null;
    await db.query('UPDATE quiz_sessions SET completed_at=NOW(), score=$1 WHERE id=$2', [score, session.id]);

    // Build correction review
    const review = await Promise.all(allQuestions.map(async q => {
      const correctChoices = await db.query('SELECT id, choice_text FROM choices WHERE question_id=$1 AND is_correct=TRUE', [q.id]);
      const mine = responses.find(r => r.question_id === q.id);
      return {
        question_id:    q.id,
        question_text:  q.question_text,
        question_type:  q.question_type,
        correct_choices: correctChoices,
        my_choice_id:   mine?.choice_id || null,
        my_text:        mine?.text_answer || null
      };
    }));

    res.json({ score, correct, total: session.total_questions, review });
  } catch (err) {
    console.error('POST /sessions/:id/submit:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// My sessions history
router.get('/mine', async (req, res) => {
  try {
    const sessions = await db.query(`
      SELECT qs.*, l.title AS list_title, c.name AS class_name
      FROM quiz_sessions qs
      JOIN lists l ON l.id = qs.list_id
      LEFT JOIN classes c ON c.id = qs.class_id
      WHERE qs.user_id = $1
      ORDER BY qs.started_at DESC
    `, [req.user.id]);
    res.json(sessions);
  } catch (err) {
    console.error('GET /sessions/mine:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Class results (teacher only)
router.get('/class/:classId/results', async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') return res.status(403).json({ error: 'Teachers only' });
  try {
    const cls = await db.queryOne('SELECT * FROM classes WHERE id=$1', [req.params.classId]);
    if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'Not authorized' });

    const results = await db.query(`
      SELECT qs.*, u.name AS student_name, u.email AS student_email, l.title AS list_title
      FROM quiz_sessions qs
      JOIN users u ON u.id = qs.user_id
      JOIN lists l ON l.id = qs.list_id
      WHERE qs.class_id=$1 AND qs.is_graded=TRUE AND qs.completed_at IS NOT NULL
      ORDER BY qs.completed_at DESC
    `, [req.params.classId]);
    res.json(results);
  } catch (err) {
    console.error('GET /sessions/class/:classId/results:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Single session detail
router.get('/:id', async (req, res) => {
  try {
    const session = await db.queryOne(`
      SELECT qs.*, l.title AS list_title FROM quiz_sessions qs
      JOIN lists l ON l.id = qs.list_id WHERE qs.id=$1
    `, [req.params.id]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const isTeacher = req.user.role === 'teacher' || req.user.role === 'admin';
    if (session.user_id !== req.user.id && !isTeacher) return res.status(403).json({ error: 'Not authorized' });

    const responses = await db.query(`
      SELECT qr.*, q.question_text, q.question_type, ch.choice_text AS selected_choice_text
      FROM quiz_responses qr
      JOIN questions q ON q.id = qr.question_id
      LEFT JOIN choices ch ON ch.id = qr.choice_id
      WHERE qr.session_id=$1
    `, [req.params.id]);

    res.json({ ...session, responses });
  } catch (err) {
    console.error('GET /sessions/:id:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
