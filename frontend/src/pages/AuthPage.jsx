import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthPage() {
  const { login, register, loading } = useAuth();
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student' });

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-layout">
      <section className="hero-card">
        <p className="eyebrow">EFREI · Révision interactive</p>
        <h1>Crée, partage et passe des quiz de révision.</h1>
        <p>
          Une application séparée proprement : base SQL PostgreSQL, API sécurisée, frontend React responsive.
        </p>
      </section>

      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Connexion' : 'Inscription'}</h2>
        {error && <p className="alert error">{error}</p>}

        {mode === 'register' && (
          <>
            <label>Nom complet</label>
            <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Paul Dupont" />
            <label>Rôle</label>
            <select value={form.role} onChange={(e) => update('role', e.target.value)}>
              <option value="student">Étudiant</option>
              <option value="teacher">Professeur</option>
            </select>
          </>
        )}

        <label>Email</label>
        <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="prenom.nom@efrei.net" />
        <label>Mot de passe</label>
        <input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="Minimum 8 caractères" />

        <button className="primary" disabled={loading}>{loading ? 'Chargement...' : 'Valider'}</button>
        <button type="button" className="link-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Créer un compte' : 'J’ai déjà un compte'}
        </button>
      </form>
    </main>
  );
}
