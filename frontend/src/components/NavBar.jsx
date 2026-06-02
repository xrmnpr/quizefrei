import { useAuth } from '../context/AuthContext.jsx';

export default function NavBar({ page, setPage }) {
  const { user, logout } = useAuth();
  const items = [
    ['dashboard', 'Accueil'],
    ['lists', 'Listes'],
    ['classes', 'Classes'],
    ['quiz', 'Quiz']
  ];

  if (user?.role === 'admin') items.push(['admin', 'Admin']);

  return (
    <header className="navbar">
      <button className="brand" onClick={() => setPage('dashboard')}>Quiz’Efrei</button>
      <nav>
        {items.map(([key, label]) => (
          <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="user-chip">
        <span>{user?.name}</span>
        <small>{user?.role}</small>
        <button onClick={logout}>Déconnexion</button>
      </div>
    </header>
  );
}
