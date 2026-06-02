import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const emptyQuestion = {
  question_text: '',
  answers: [
    { answer_text: '', is_correct: true },
    { answer_text: '', is_correct: false }
  ]
};

export default function ListsPage() {
  const { user } = useAuth();
  const [lists, setLists] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ title: '', description: '', visibility: 'private', class_id: '' });
  const [shareEmail, setShareEmail] = useState('');
  const [question, setQuestion] = useState(emptyQuestion);

  useEffect(() => {
    loadLists();
    loadClasses();
  }, []);

  async function loadLists() {
    const data = await api('/lists');
    setLists(data.lists);
  }

  async function loadClasses() {
    const data = await api('/classes');
    setClasses(data.classes);
  }

  async function createList(event) {
    event.preventDefault();
    setMessage('');
    const payload = { ...form, class_id: form.class_id || null };
    await api('/lists', { method: 'POST', body: JSON.stringify(payload) });
    setForm({ title: '', description: '', visibility: 'private', class_id: '' });
    setMessage('Liste créée.');
    loadLists();
  }

  async function openList(list) {
    setSelected(list);
    const data = await api(`/lists/${list.id}`);
    setDetails(data);
  }

  async function deleteList(id) {
    await api(`/lists/${id}`, { method: 'DELETE' });
    setSelected(null);
    setDetails(null);
    loadLists();
  }

  async function shareList(event) {
    event.preventDefault();
    if (!selected) return;
    await api(`/lists/${selected.id}/share`, {
      method: 'POST',
      body: JSON.stringify({ email: shareEmail, can_edit: false })
    });
    setShareEmail('');
    setMessage('Liste partagée.');
  }

  function updateAnswer(index, patch) {
    setQuestion((current) => ({
      ...current,
      answers: current.answers.map((answer, i) => (i === index ? { ...answer, ...patch } : answer))
    }));
  }

  async function addQuestion(event) {
    event.preventDefault();
    if (!selected) return;
    await api(`/lists/${selected.id}/questions`, {
      method: 'POST',
      body: JSON.stringify(question)
    });
    setQuestion(emptyQuestion);
    openList(selected);
    loadLists();
  }

  return (
    <main className="page split-page">
      <section>
        <div className="page-title compact">
          <h1>Listes de révision</h1>
          <p>Crée tes listes, ajoute des questions, partage-les ou rattache-les à une classe.</p>
        </div>

        {message && <p className="alert success">{message}</p>}

        <form className="card form-card" onSubmit={createList}>
          <h3>Nouvelle liste</h3>
          <label>Titre</label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Réseaux - NAT & routage" />
          <label>Description</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Objectif de la liste" />
          <label>Visibilité</label>
          <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
            <option value="private">Privée</option>
            <option value="shared">Partagée</option>
            <option value="public">Publique</option>
          </select>
          {(user.role === 'teacher' || user.role === 'admin') && (
            <>
              <label>Classe optionnelle</label>
              <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })}>
                <option value="">Aucune classe</option>
                {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </>
          )}
          <button className="primary">Créer</button>
        </form>

        <div className="list-stack">
          {lists.map((list) => (
            <button key={list.id} className={`list-item ${selected?.id === list.id ? 'selected' : ''}`} onClick={() => openList(list)}>
              <strong>{list.title}</strong>
              <span>{list.question_count} question(s) · {list.visibility} {list.class_name ? `· ${list.class_name}` : ''}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="details-panel">
        {!details ? (
          <div className="empty-state">Sélectionne une liste pour voir son contenu.</div>
        ) : (
          <>
            <div className="panel-header">
              <div>
                <h2>{details.list.title}</h2>
                <p>{details.list.description}</p>
              </div>
              <button className="danger" onClick={() => deleteList(details.list.id)}>Supprimer</button>
            </div>

            <form className="inline-form" onSubmit={shareList}>
              <input type="email" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} placeholder="email étudiant" />
              <button>Partager</button>
            </form>

            <form className="card form-card" onSubmit={addQuestion}>
              <h3>Ajouter une question</h3>
              <label>Question</label>
              <textarea value={question.question_text} onChange={(e) => setQuestion({ ...question, question_text: e.target.value })} />
              {question.answers.map((answer, index) => (
                <div className="answer-row" key={index}>
                  <input value={answer.answer_text} onChange={(e) => updateAnswer(index, { answer_text: e.target.value })} placeholder={`Réponse ${index + 1}`} />
                  <label className="check-label">
                    <input type="checkbox" checked={answer.is_correct} onChange={(e) => updateAnswer(index, { is_correct: e.target.checked })} /> correcte
                  </label>
                </div>
              ))}
              <button type="button" onClick={() => setQuestion({ ...question, answers: [...question.answers, { answer_text: '', is_correct: false }] })}>+ réponse</button>
              <button className="primary">Ajouter</button>
            </form>

            <div className="questions-list">
              {details.questions.map((q, index) => (
                <article className="question-card" key={q.id}>
                  <h4>{index + 1}. {q.question_text}</h4>
                  <ul>
                    {q.answers.map((answer) => (
                      <li key={answer.id} className={answer.is_correct ? 'correct' : ''}>{answer.answer_text}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </>
        )}
      </aside>
    </main>
  );
}
