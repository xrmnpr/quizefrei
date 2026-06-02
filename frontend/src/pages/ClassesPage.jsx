import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ClassesPage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [students, setStudents] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [lists, setLists] = useState([]);
  const [message, setMessage] = useState('');
  const [newClass, setNewClass] = useState({ name: '', description: '' });
  const [joinCode, setJoinCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [evaluation, setEvaluation] = useState({ title: '', list_id: '', time_limit_seconds: 600 });

  useEffect(() => {
    loadClasses();
    loadLists();
  }, []);

  async function loadClasses() {
    const data = await api('/classes');
    setClasses(data.classes);
  }

  async function loadLists() {
    const data = await api('/lists');
    setLists(data.lists);
  }

  async function createClass(event) {
    event.preventDefault();
    await api('/classes', { method: 'POST', body: JSON.stringify(newClass) });
    setNewClass({ name: '', description: '' });
    setMessage('Classe créée.');
    loadClasses();
  }

  async function joinClass(event) {
    event.preventDefault();
    await api('/classes/join', { method: 'POST', body: JSON.stringify({ join_code: joinCode }) });
    setJoinCode('');
    setMessage('Classe rejointe.');
    loadClasses();
  }

  async function openClass(item) {
    setSelected(item);
    setStudents([]);
    setEvaluations([]);
    const ev = await api(`/classes/${item.id}/evaluations`);
    setEvaluations(ev.evaluations);
    if (user.role === 'teacher' || user.role === 'admin') {
      const st = await api(`/classes/${item.id}/students`);
      setStudents(st.students);
    }
  }

  async function invite(event) {
    event.preventDefault();
    await api(`/classes/${selected.id}/invite`, { method: 'POST', body: JSON.stringify({ email: inviteEmail }) });
    setInviteEmail('');
    setMessage('Étudiant invité.');
    openClass(selected);
  }

  async function createEvaluation(event) {
    event.preventDefault();
    await api(`/classes/${selected.id}/evaluations`, { method: 'POST', body: JSON.stringify(evaluation) });
    setEvaluation({ title: '', list_id: '', time_limit_seconds: 600 });
    setMessage('Évaluation créée.');
    openClass(selected);
  }

  const classLists = lists.filter((list) => list.class_id === selected?.id);

  return (
    <main className="page split-page">
      <section>
        <div className="page-title compact">
          <h1>Classes</h1>
          <p>Les professeurs gèrent les classes et les évaluations. Les étudiants rejoignent avec un code.</p>
        </div>

        {message && <p className="alert success">{message}</p>}

        {(user.role === 'teacher' || user.role === 'admin') && (
          <form className="card form-card" onSubmit={createClass}>
            <h3>Créer une classe</h3>
            <input value={newClass.name} onChange={(e) => setNewClass({ ...newClass, name: e.target.value })} placeholder="Ex: L3 Cyber - Groupe A" />
            <textarea value={newClass.description} onChange={(e) => setNewClass({ ...newClass, description: e.target.value })} placeholder="Description" />
            <button className="primary">Créer</button>
          </form>
        )}

        <form className="card form-card" onSubmit={joinClass}>
          <h3>Rejoindre une classe</h3>
          <div className="inline-form no-margin">
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Code de classe" />
            <button>Rejoindre</button>
          </div>
        </form>

        <div className="list-stack">
          {classes.map((item) => (
            <button key={item.id} className={`list-item ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => openClass(item)}>
              <strong>{item.name}</strong>
              <span>Prof: {item.teacher_name} · Code: {item.join_code} · {item.student_count} membre(s)</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="details-panel">
        {!selected ? <div className="empty-state">Sélectionne une classe.</div> : (
          <>
            <div className="panel-header">
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.description}</p>
              </div>
              <span className="pill">{selected.join_code}</span>
            </div>

            {(user.role === 'teacher' || user.role === 'admin') && (
              <>
                <form className="inline-form" onSubmit={invite}>
                  <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email étudiant" />
                  <button>Inviter</button>
                </form>

                <form className="card form-card" onSubmit={createEvaluation}>
                  <h3>Créer une évaluation notée</h3>
                  <input value={evaluation.title} onChange={(e) => setEvaluation({ ...evaluation, title: e.target.value })} placeholder="Titre" />
                  <select value={evaluation.list_id} onChange={(e) => setEvaluation({ ...evaluation, list_id: e.target.value })}>
                    <option value="">Choisir une liste de cette classe</option>
                    {classLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
                  </select>
                  <input type="number" value={evaluation.time_limit_seconds} onChange={(e) => setEvaluation({ ...evaluation, time_limit_seconds: Number(e.target.value) })} />
                  <button className="primary">Publier</button>
                </form>

                <h3>Étudiants</h3>
                <div className="table-like">
                  {students.map((student) => (
                    <div key={student.id}><strong>{student.name}</strong><span>{student.email}</span></div>
                  ))}
                </div>
              </>
            )}

            <h3>Évaluations</h3>
            <div className="questions-list">
              {evaluations.map((ev) => (
                <article className="question-card" key={ev.id}>
                  <h4>{ev.title}</h4>
                  <p>Liste : {ev.list_title}</p>
                  <p>Temps limite : {Math.round(ev.time_limit_seconds / 60)} min</p>
                </article>
              ))}
            </div>
          </>
        )}
      </aside>
    </main>
  );
}
