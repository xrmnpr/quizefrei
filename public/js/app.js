const App = (() => {
  let currentUser = null;
  let currentPage = null;
  let pendingRegistrationToken = null; // stored server-side reference, never in DOM

  function getUser() { return currentUser; }

  // ── Google / Easy Auth ────────────────────────────────────────────────────

  function signInWithGoogle() {
    window.location.href = '/.auth/login/google?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname + window.location.search);
  }

  function showAuth() {
    document.getElementById('authModal').classList.remove('hidden');
  }
  function closeAuth() {
    document.getElementById('authModal').classList.add('hidden');
  }

  // Show role-picker after Google auth for new accounts
  function showRoleSelection() {
    Modal.show(`
      <div style="text-align:center;margin-bottom:1.5rem">
        <div style="font-size:2rem;margin-bottom:.5rem">👋</div>
        <h2 style="margin-bottom:.5rem">Bienvenue !</h2>
        <p style="color:var(--text-muted);font-size:.9rem">Avant de commencer, dites-nous qui vous êtes.</p>
      </div>
      <div class="role-select" style="margin-bottom:1.5rem">
        <label class="role-option">
          <input type="radio" name="reg_role" value="student" checked>
          <span class="role-card"><span class="role-card-icon">🎓</span><span>Étudiant</span></span>
        </label>
        <label class="role-option">
          <input type="radio" name="reg_role" value="teacher">
          <span class="role-card"><span class="role-card-icon">👨‍🏫</span><span>Enseignant</span></span>
        </label>
      </div>
      <div id="regError" class="form-error hidden"></div>
      <button class="btn btn-primary btn-full" id="confirmRoleBtn">Créer mon compte</button>
    `);
    document.getElementById('confirmRoleBtn').onclick = completeRegistration;
  }

  async function completeRegistration() {
    const role = document.querySelector('input[name="reg_role"]:checked')?.value;
    const errEl = document.getElementById('regError');
    if (!role) return;

    const btn = document.getElementById('confirmRoleBtn');
    btn.disabled = true;
    btn.textContent = 'Création...';
    errEl.classList.add('hidden');

    try {
      const data = await API.completeRegistration(pendingRegistrationToken, role);
      pendingRegistrationToken = null;
      API.setToken(data.token);
      currentUser = data.user;
      Modal.close();
      closeAuth();
      mountApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Créer mon compte';
      // Token may have expired — send user back to Google
      if (err.status === 401) {
        setTimeout(() => signInWithGoogle(), 2000);
      }
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function navigate(page) {
    const pages = {
      dashboard:      'dashboardPage',
      lists:          'listsPage',
      'list-detail':  'listDetailPage',
      quiz:           'quizPage',
      classes:        'classesPage',
      'class-detail': 'classDetailPage',
      admin:          'adminPage'
    };

    Object.values(pages).forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById(pages[page])?.classList.remove('hidden');
    currentPage = page;

    document.querySelectorAll('.nav-link').forEach(l => {
      const p = l.dataset.page;
      l.classList.toggle('active',
        p === page ||
        (p === 'lists'   && (page === 'list-detail' || page === 'quiz')) ||
        (p === 'classes' && page === 'class-detail')
      );
    });

    if (page === 'dashboard') loadDashboard();
    else if (page === 'lists')   Lists.load();
    else if (page === 'classes') Classes.load();
    else if (page === 'admin')   Admin.load();

    window.scrollTo(0, 0);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

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
      const [lists, sessions, classes] = await Promise.all([
        API.getMyLists(),
        API.getMySessions(),
        API.getClasses()
      ]);

      const scored = sessions.filter(s => s.score !== null);
      const avg = scored.length
        ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)
        : null;

      document.getElementById('statsRow').innerHTML = `
        <div class="stat-card"><div class="stat-value">${lists.length}</div><div class="stat-label">Mes listes</div></div>
        <div class="stat-card"><div class="stat-value">${sessions.length}</div><div class="stat-label">Quiz effectués</div></div>
        <div class="stat-card"><div class="stat-value">${classes.length}</div><div class="stat-label">Classes</div></div>
        ${avg !== null ? `<div class="stat-card"><div class="stat-value">${avg}%</div><div class="stat-label">Score moyen</div></div>` : ''}
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
              <div class="activity-title">${esc(s.list_title)}</div>
              <div class="activity-meta">${s.score !== null ? `Score : ${s.score}%` : 'Réponse libre'} · ${new Date(s.started_at).toLocaleDateString('fr-FR')}</div>
            </div>
          </div>
        `).join('');
      }
    } catch { /* stats are non-critical */ }
  }

  // ── Mount / unmount ───────────────────────────────────────────────────────

  function mountApp() {
    document.getElementById('landing').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');

    const user = currentUser;
    document.getElementById('userName').textContent = user.name;
    const roleLbl = document.getElementById('roleLabel');
    roleLbl.textContent = { student: 'Étudiant', teacher: 'Enseignant', admin: 'Admin' }[user.role] || user.role;
    roleLbl.className = 'role-badge' + (user.role === 'teacher' ? ' teacher' : user.role === 'admin' ? ' admin' : '');

    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', user.role !== 'admin'));

    document.querySelectorAll('.nav-link').forEach(l => {
      l.addEventListener('click', e => { e.preventDefault(); navigate(l.dataset.page); });
    });

    document.getElementById('logoutBtn').onclick = () => {
      API.clearToken();
      // Clear Azure Easy Auth session too
      window.location.href = '/.auth/logout?post_logout_redirect_uri=/';
    };

    navigate('dashboard');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    // 1. Existing JWT — verify it's still valid
    if (API.getToken()) {
      try {
        currentUser = await API.me();
        mountApp();
        return;
      } catch {
        API.clearToken(); // expired or invalid
      }
    }

    // 2. Returning from Google OAuth — Azure Easy Auth session exists
    try {
      const res = await fetch('/.auth/me');
      const sessions = await res.json();
      if (Array.isArray(sessions) && sessions.length > 0) {
        const data = await API.googleAuth();

        if (data.needs_registration) {
          // New user — store token and show role picker
          pendingRegistrationToken = data.registration_token;
          document.getElementById('landing').classList.remove('hidden');
          showRoleSelection();
          return;
        }

        API.setToken(data.token);
        currentUser = data.user;
        mountApp();
        return;
      }
    } catch { /* not authenticated with Google yet */ }

    // 3. No session — show landing page
    document.getElementById('landing').classList.remove('hidden');
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Close auth modal on backdrop click
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('authModal').addEventListener('click', e => {
      if (e.target === document.getElementById('authModal')) closeAuth();
    });
    init();
  });

  return { init, getUser, navigate, signInWithGoogle, showAuth, closeAuth, loadDashboard };
})();
