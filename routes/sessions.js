const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Start a quiz session
router.post('/start', (req, res) => {
  const { list_id, class_id, time_limit, is_graded } = req.body;
  if (!list_id) return res.status(400).json({ error: 'list_id is required' });

  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(list_id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const questions = db.prepare('SELECT * FROM questions WHERE list_id = ? ORDER BY order_index').all(list_id);
  if (questions.length === 0) return res.status(400).json({ error: 'List has no questions' });

  // For graded sessions, only teachers can create them
  if (is_graded && req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only teachers can create graded sessions' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO quiz_sessions (id, list_id, user_id, class_id, time_limit, total_questions, is_graded)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, list_id, req.user.id, class_id || null, time_limit || null, questions.length, is_graded ? 1 : 0);

  const questionsWithChoices = questions.map(q => ({
    ...q,
    choices: db.prepare('SELECT id, choice_text FROM choices WHERE question_id = ?').all(q.id)
  }));

  res.status(201).json({
    session_id: id,
    list_title: list.title,
    time_limit: time_limit || null,
    questions: questionsWithChoices
  });
});

// Submit answers and complete session
router.post('/:id/submit', (req, res) => {
  const session = db.prepare('SELECT * FROM quiz_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
  if (session.completed_at) return res.status(400).json({ error: 'Session already completed' });

  const { responses } = req.body;
  if (!Array.isArray(responses)) return res.status(400).json({ error: 'responses must be an array' });

  let correct = 0;
  const results = [];

  for (const r of responses) {
    const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(r.question_id);
    if (!question || question.list_id !== session.list_id) continue;

    let isCorrect = null;
    let choiceId = null;

    if (question.question_type === 'short_answer') {
      isCorrect = null; // manual grading for short answers
    } else {
      choiceId = r.choice_id;
      if (choiceId) {
        const choice = db.prepare('SELECT * FROM choices WHERE id = ? AND question_id = ?').get(choiceId, question.id);
        isCorrect = choice ? (choice.is_correct === 1 ? 1 : 0) : 0;
        if (isCorrect) correct++;
      } else {
        isCorrect = 0;
      }
    }

    const responseId = uuidv4();
    db.prepare(`
      INSERT INTO quiz_responses (id, session_id, question_id, choice_id, text_answer, is_correct)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(responseId, session.id, question.id, choiceId, r.text_answer || null, isCorrect);

    results.push({ question_id: question.id, is_correct: isCorrect });
  }

  const totalAuto = responses.filter(r => {
    const q = db.prepare('SELECT question_type FROM questions WHERE id = ?').get(r.question_id);
    return q && q.question_type !== 'short_answer';
  }).length;

  const score = totalAuto > 0 ? Math.round((correct / session.total_questions) * 100) : null;

  db.prepare('UPDATE quiz_sessions SET completed_at = datetime(\'now\'), score = ? WHERE id = ?').run(score, session.id);

  // Fetch correct answers for review
  const questions = db.prepare('SELECT * FROM questions WHERE list_id = ? ORDER BY order_index').all(session.list_id);
  const review = questions.map(q => {
    const correctChoices = db.prepare('SELECT id, choice_text FROM choices WHERE question_id = ? AND is_correct = 1').all(q.id);
    const myResponse = responses.find(r => r.question_id === q.id);
    return {
      question_id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      correct_choices: correctChoices,
      my_choice_id: myResponse?.choice_id || null,
      my_text: myResponse?.text_answer || null
    };
  });

  res.json({ score, correct, total: session.total_questions, review });
});

// Get my sessions
router.get('/mine', (req, res) => {
  const sessions = db.prepare(`
    SELECT qs.*, l.title as list_title, c.name as class_name
    FROM quiz_sessions qs
    JOIN lists l ON l.id = qs.list_id
    LEFT JOIN classes c ON c.id = qs.class_id
    WHERE qs.user_id = ?
    ORDER BY qs.started_at DESC
  `).all(req.user.id);
  res.json(sessions);
});

// Get session details
router.get('/:id', (req, res) => {
  const session = db.prepare(`
    SELECT qs.*, l.title as list_title FROM quiz_sessions qs
    JOIN lists l ON l.id = qs.list_id WHERE qs.id = ?
  `).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const isTeacher = req.user.role === 'teacher' || req.user.role === 'admin';
  if (session.user_id !== req.user.id && !isTeacher) return res.status(403).json({ error: 'Not authorized' });

  const responses = db.prepare(`
    SELECT qr.*, q.question_text, q.question_type, ch.choice_text as selected_choice_text
    FROM quiz_responses qr
    JOIN questions q ON q.id = qr.question_id
    LEFT JOIN choices ch ON ch.id = qr.choice_id
    WHERE qr.session_id = ?
  `).all(req.params.id);

  res.json({ ...session, responses });
});

// Teacher: get all results for a class
router.get('/class/:classId/results', (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Teachers only' });
  }

  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.classId);
  if (!cls || (cls.teacher_id !== req.user.id && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const results = db.prepare(`
    SELECT qs.*, u.name as student_name, u.email as student_email, l.title as list_title
    FROM quiz_sessions qs
    JOIN users u ON u.id = qs.user_id
    JOIN lists l ON l.id = qs.list_id
    WHERE qs.class_id = ? AND qs.is_graded = 1 AND qs.completed_at IS NOT NULL
    ORDER BY qs.completed_at DESC
  `).all(req.params.classId);

  res.json(results);
});

module.exports = router;
