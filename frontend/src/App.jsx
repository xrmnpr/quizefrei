import { useState } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import NavBar from './components/NavBar.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ListsPage from './pages/ListsPage.jsx';
import ClassesPage from './pages/ClassesPage.jsx';
import QuizPage from './pages/QuizPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

export default function App() {
  const { user } = useAuth();
  const [page, setPage] = useState('dashboard');

  if (!user) return <AuthPage />;

  return (
    <>
      <NavBar page={page} setPage={setPage} />
      {page === 'dashboard' && <Dashboard setPage={setPage} />}
      {page === 'lists' && <ListsPage />}
      {page === 'classes' && <ClassesPage />}
      {page === 'quiz' && <QuizPage />}
      {page === 'admin' && <AdminPage />}
    </>
  );
}
