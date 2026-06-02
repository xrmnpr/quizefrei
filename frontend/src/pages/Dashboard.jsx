import { useAuth } from '../context/AuthContext.jsx';

export default function Dashboard({ setPage }) {
  const { user } = useAuth();

  return (
    <main className="page">
      <section className="page-title">
        <p className="eyebrow">Bienvenue, {user.name}</p>
        <h1>Tableau de bord Quiz’Efrei</h1>
        <p>Ton espace est adapté au rôle connecté : étudiant, professeur ou administrateur.</p>
      </section>

      <section className="grid cards-3">
        <article className="card">
          <h3>Listes de révision</h3>
          <p>Créer, modifier, supprimer et partager des listes de questions.</p>
          <button onClick={() => setPage('lists')}>Gérer les listes</button>
        </article>
        <article className="card">
          <h3>Quiz interactifs</h3>
          <p>Lancer une session avec un temps limite et un score automatique.</p>
          <button onClick={() => setPage('quiz')}>S’entraîner</button>
        </article>
        <article className="card">
          <h3>{user.role === 'teacher' ? 'Classes & évaluations' : 'Cours partagés'}</h3>
          <p>{user.role === 'teacher' ? 'Créer des classes, inviter des étudiants et publier des évaluations notées.' : 'Rejoindre une classe avec un code et accéder aux listes du professeur.'}</p>
          <button onClick={() => setPage('classes')}>Voir les classes</button>
        </article>
      </section>
    </main>
  );
}
