import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

export default function QuizPage() {
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState('');
  const [timeLimit, setTimeLimit] = useState(600);
  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    api('/lists').then((data) => setLists(data.lists));
  }, []);

  useEffect(() => {
    if (!session || result) return;
    setRemaining(session.time_limit_seconds);
    const startedAt = new Date(session.started_at).getTime();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, session.time_limit_seconds - elapsed);
      setRemaining(left);
      if (left === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [session, result]);

  const minutes = useMemo(() => {
    const min = Math.floor(remaining / 60).toString().padStart(2, '0');
    const sec = (remaining % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  }, [remaining]);

  async function startQuiz(event) {
    event.preventDefault();
    const data = await api('/quizzes/sessions', {
      method: 'POST',
      body: JSON.stringify({ list_id: selectedList, time_limit_seconds: Number(timeLimit) })
    });
    setSession(data.session);
    setQuestions(data.questions);
    setAnswers({});
    setResult(null);
  }

  async function submitQuiz() {
    const payload = Object.entries(answers).map(([question_id, answer_id]) => ({ question_id, answer_id }));
    const data = await api(`/quizzes/sessions/${session.id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers: payload })
    });
    setResult(data);
  }

  if (session && !result) {
    return (
      <main className="page quiz-layout">
        <div className="quiz-topbar">
          <h1>Quiz en cours</h1>
          <span className={`timer ${remaining < 60 ? 'urgent' : ''}`}>{minutes}</span>
        </div>

        <section className="questions-list">
          {questions.map((question, index) => (
            <article className="question-card" key={question.id}>
              <h3>{index + 1}. {question.question_text}</h3>
              <div className="answer-options">
                {question.answers.map((answer) => (
                  <label key={answer.id} className={answers[question.id] === answer.id ? 'option selected' : 'option'}>
                    <input
                      type="radio"
                      name={question.id}
                      checked={answers[question.id] === answer.id}
                      onChange={() => setAnswers({ ...answers, [question.id]: answer.id })}
                    />
                    {answer.answer_text}
                  </label>
                ))}
              </div>
            </article>
          ))}
        </section>
        <button className="primary floating-submit" onClick={submitQuiz}>Terminer le quiz</button>
      </main>
    );
  }

  if (result) {
    return (
      <main className="page quiz-layout">
        <section className="result-card">
          <p className="eyebrow">Score automatique</p>
          <h1>{result.session.score} / {result.session.total_questions}</h1>
          <p>Session soumise le {new Date(result.session.submitted_at).toLocaleString('fr-FR')}.</p>
          <button onClick={() => { setSession(null); setResult(null); }}>Recommencer</button>
        </section>

        <h2>Correction</h2>
        <section className="questions-list">
          {result.correction.map((question) => (
            <article className="question-card" key={question.id}>
              <h3>{question.question_text}</h3>
              <ul>
                {question.answers.map((answer) => (
                  <li key={answer.id} className={answer.is_correct ? 'correct' : ''}>{answer.answer_text}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="page centered-page">
      <form className="card start-quiz" onSubmit={startQuiz}>
        <p className="eyebrow">Moteur de quiz</p>
        <h1>Lancer un entraînement</h1>
        <label>Liste de révision</label>
        <select value={selectedList} onChange={(e) => setSelectedList(e.target.value)}>
          <option value="">Choisir une liste</option>
          {lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
        </select>
        <label>Temps limite en secondes</label>
        <input type="number" min="30" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} />
        <button className="primary">Démarrer</button>
      </form>
    </main>
  );
}
