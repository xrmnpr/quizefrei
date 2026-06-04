const App = (() => {
  let currentUser = null;
  let currentPage = null;

  function getUser() { return currentUser; }

  function showAuth(tab = 'login') {
    document.getElementById('authModal').classList.remove('hidden');
    switchAuthTab(tab);
  }
  function closeAuth() { document.getElementById('authModal').classList.add('hidden'); }

  function switchAuthTab(tab) {
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
    document.getElementById('loginTab').classList.toggle('active', tab === 'login');
    document.getElementById('registerTab').classList.toggle('active', tab === 'register');
  }

  function navigate(page) {
    const pages = {
      dashboard: 'dashboardPage',
      lists: 'listsPage',
      'list-detail': 'listDetailPage',
      quiz: 'quizPage',
      classes: 'classesPage',
      'class-detail': 'classDetailPage',
      admin: 'adminPage'
    };

    Object.values(pages).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    const target = pages[page];
    if (target) document.getElementById(target)?.classList.remove('hidden');

    currentPage = page;

    document.querySelectorAll('.nav-link').forEach(l => {
      const p = l.dataset.page;
      l.classList.toggle('active', p === page || (p === 'lists' && (page === 'list-detail' || page === 'quiz')) || (p === 'classes' && page === 'class-detail'));
    });

    if (page === 'dashboard') loadDashboard();
    else if (page === 'lists') Lists.load();
    else if (page === 'classes') Classes.load();
    else if (page === 'admin') Admin.load();

    window.scrollTo(0, 0);
  }

  async function loadDashboard() {
    const user = currentUser;
    document.getElementById('dashGreeting').textContent = `Bonjour, ${user.name.split(' ')[0]} !`;
    document.getElementById('dashSub').textContent = user.role === 'teacher'
      ? 'Gérez vos classes et listes de révision'
      : 'Continuez à réviser et progressez !';

    const shortcuts = document.getElementById('shortcuts');
    if (user.role === 'teacher' || user.role === 'admin') {
      shortcuts.innerHTML = `
        <button class="shortcut-btn" onclick="App.navigate('lists');setTimeout(()=>Lists.showCreate(),100)"><span class="shortcut-icon">📝</span> Nouvelle liste</button>
        <button class="shortcut-btn" onclick="App.navigate('classes');setTimeout(()=>Classes.showCreate(),100)"><span class="shortcut-icon">🏫</span> Nouvelle classe</button>
        <button class="shortcut-btn" onclick="App.navigate('lists')"><span class="shortcut-icon">📚</span> Mes listes</button>
        <button class="shortcut-btn" onclick="App.navigate('classes')"><span class="shortcut-icon">👥</span> Mes classes</button>
      `;
    } else {
      shortcuts.innerHTML = `
        <button class="shortcut-btn" onclick="App.navigate('lists')"><span class="shortcut-icon">📚</span> Mes listes</button>
        <button class="shortcut-btn" onclick="App.navigate('lists');setTimeout(()=>Lists.showCreate(),100)"><span class="shortcut-icon">➕</span> Créer une liste</button>
        <button class="shortcut-btn" onclick="App.navigate('classes');setTimeout(()=>Classes.showJoin(),100)"><span class="shortcut-icon">🔑</span> Rejoindre une classe</button>
        <button class="shortcut-btn" onclick="App.navigate('classes')"><span class="shortcut-icon">🏫</span> Mes classes</button>
      `;
    }

    try {
      const [lists, sessions] = await Promise.all([API.getMyLists(), API.getMySessions()]);
      const classes = await API.getClasses();

      const statsRow = document.getElementById('statsRow');
      statsRow.innerHTML = `
        <div class="stat-card"><div class="stat-value">${lists.length}</div><div class="stat-label">Mes listes</div></div>
        <div class="stat-card"><div class="stat-value">${sessions.length}</div><div class="stat-label">Quiz effectués</div></div>
        <div class="stat-card"><div class="stat-value">${classes.length}</div><div class="stat-label">Classes</div></div>
        ${sessions.filter(s => s.score !== null).length > 0 ? `
          <div class="stat-card">
            <div class="stat-value">${Math.round(sessions.filter(s => s.score !== null).reduce((a, s) => a + s.score, 0) / sessions.filter(s => s.score !== null).length)}%</div>
            <div class="stat-label">Score moyen</div>
          </div>` : ''}
      `;

      const recent = sessions.slice(0, 5);
      const activity = document.getElementById('recentActivity');
      if (!recent.length) {
        activity.innerHTML = '<div class="empty-state" style="padding:2rem"><div class="empty-icon">🚀</div><div class="empty-title">Aucune activité</div><div class="empty-text">Commencez votre premier quiz !</div></div>';
      } else {
        activity.innerHTML = recent.map(s => `
          <div class="activity-item">
            <span class="activity-icon">${s.score !== null ? (s.score >= 80 ? '🎉' : s.score >= 60 ? '👍' : '📚') : '✏'}</span>
            <div class="activity-info">
              <div class="activity-title">${escHtml(s.list_title)}</div>
              <div class="activity-meta">${s.score !== null ? `Score : ${s.score}%` : 'Réponse libre'} · ${new Date(s.started_at).toLocaleDateString('fr-FR')}</div>
            </div>
          </div>
        `).join('');
      }
    } catch {}
  }

  function setupAuth() {
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('loginError');
      errEl.classList.add('hidden');
      try {
        const res = await API.login(fd.get('email'), fd.get('password'));
        API.setToken(res.token);
        currentUser = res.user;
        localStorage.setItem('qe_user', JSON.stringify(res.user));
        closeAuth();
        mountApp();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    };

    document.getElementById('registerForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('registerError');
      errEl.classList.add('hidden');
      try {
        const res = await API.register({ email: fd.get('email'), password: fd.get('password'), name: fd.get('name'), role: fd.get('role') });
        API.setToken(res.token);
        currentUser = res.user;
        localStorage.setItem('qe_user', JSON.stringify(res.user));
        closeAuth();
        mountApp();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    };

    document.getElementById('logoutBtn').onclick = () => {
      API.clearToken();
      currentUser = null;
      unmountApp();
    };

    document.getElementById('authModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('authModal')) closeAuth();
    });

    document.querySelectorAll('.nav-link').forEach(l => {
      l.addEventListener('click', (e) => { e.preventDefault(); navigate(l.dataset.page); });
    });
  }

  function mountApp() {
    document.getElementById('landing').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');
    document.getElementById('navbar').classList.remove('hidden');

    const user = currentUser;
    document.getElementById('userName').textContent = user.name;
    const roleLbl = document.getElementById('roleLabel');
    roleLbl.textContent = { student: 'Étudiant', teacher: 'Enseignant', admin: 'Admin' }[user.role] || user.role;
    roleLbl.className = 'role-badge ' + (user.role === 'teacher' ? 'teacher' : user.role === 'admin' ? 'admin' : '');

    document.querySelectorAll('.admin-only').forEach(el => {
      el.classList.toggle('hidden', user.role !== 'admin');
    });

    navigate('dashboard');
  }

  function unmountApp() {
    document.getElementById('appContainer').classList.add('hidden');
    document.getElementById('navbar').style.display = '';
    document.getElementById('landing').classList.remove('hidden');
    currentPage = null;
  }

  async function init() {
    setupAuth();
    const token = API.getToken();
    if (token) {
      try {
        const user = await API.me();
        currentUser = user;
        localStorage.setItem('qe_user', JSON.stringify(user));
        mountApp();
        return;
      } catch {
        API.clearToken();
      }
    }
    document.getElementById('landing').classList.remove('hidden');
  }

  function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { init, getUser, navigate, showAuth, closeAuth, switchAuthTab };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
