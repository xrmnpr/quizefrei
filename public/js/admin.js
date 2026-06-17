const Admin = (() => {
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  let state = { tab: 'users', search: '', roleFilter: 'all', stats: null, users: [], lists: [], classes: [], sessions: [] };

  async function load() {
    const content = document.getElementById('adminContent');
    content.innerHTML = '<div class="loading"><div class="spinner"></div>Chargement...</div>';
    try {
      const [stats, users, lists, classes, sessions] = await Promise.all([
        API.adminStats(), API.adminUsers(), API.getLists(), API.getClasses(), API.adminSessions()
      ]);
      state = { ...state, stats, users, lists, classes, sessions };
      render();
    } catch { content.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-title">Erreur</div></div>'; }
  }

  function switchTab(tab) {
    state.tab = tab;
    render();
  }

  function setSearch(value) {
    state.search = value.toLowerCase();
    renderTabBody();
  }

  function setRoleFilter(role) {
    state.roleFilter = role;
    render();
  }

  function render() {
    const { stats } = state;
    document.getElementById('adminContent').innerHTML = `
      <div class="stats-row" style="margin-bottom:2rem">
        <div class="stat-card"><div class="stat-value">${stats.users}</div><div class="stat-label">Utilisateurs</div></div>
        <div class="stat-card"><div class="stat-value">${stats.students}</div><div class="stat-label">Étudiants</div></div>
        <div class="stat-card"><div class="stat-value">${stats.teachers}</div><div class="stat-label">Enseignants</div></div>
        <div class="stat-card"><div class="stat-value">${stats.lists}</div><div class="stat-label">Listes</div></div>
        <div class="stat-card"><div class="stat-value">${stats.classes}</div><div class="stat-label">Classes</div></div>
        <div class="stat-card"><div class="stat-value">${stats.completed_sessions}</div><div class="stat-label">Quiz terminés</div></div>
      </div>

      <div class="tabs-row">
        <button class="tab-btn ${state.tab==='users'?'active':''}" onclick="Admin.switchTab('users')">Utilisateurs</button>
        <button class="tab-btn ${state.tab==='lists'?'active':''}" onclick="Admin.switchTab('lists')">Listes</button>
        <button class="tab-btn ${state.tab==='classes'?'active':''}" onclick="Admin.switchTab('classes')">Classes</button>
        <button class="tab-btn ${state.tab==='sessions'?'active':''}" onclick="Admin.switchTab('sessions')">Quiz</button>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;box-shadow:var(--shadow)">
        <div id="adminTabBody"></div>
      </div>
    `;
    renderTabBody();
  }

  function renderTabBody() {
    const body = document.getElementById('adminTabBody');
    if (!body) return;
    if (state.tab === 'users') body.innerHTML = usersTabHtml();
    else if (state.tab === 'lists') body.innerHTML = listsTabHtml();
    else if (state.tab === 'classes') body.innerHTML = classesTabHtml();
    else body.innerHTML = sessionsTabHtml();
  }

  function filteredUsers() {
    return state.users.filter(u => {
      if (state.roleFilter !== 'all' && u.role !== state.roleFilter) return false;
      if (!state.search) return true;
      return u.name.toLowerCase().includes(state.search) || u.email.toLowerCase().includes(state.search);
    });
  }

  function usersTabHtml() {
    const users = filteredUsers();
    const roleFilterBtn = (role, label) => `
      <button class="btn btn-sm ${state.roleFilter===role?'btn-primary':'btn-outline'}" onclick="Admin.setRoleFilter('${role}')">${label}</button>`;

    return `
      <div class="search-row" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        <input type="text" class="search-input" style="flex:1;min-width:200px" placeholder="Rechercher un utilisateur..." value="${esc(state.search)}" oninput="Admin.setSearch(this.value)">
        <div style="display:flex;gap:.5rem">
          ${roleFilterBtn('all','Tous')}
          ${roleFilterBtn('student','Étudiants')}
          ${roleFilterBtn('teacher','Enseignants')}
          ${roleFilterBtn('admin','Admins')}
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Inscrit le</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.length === 0 ? `<tr><td colspan="5" class="text-sm text-muted">Aucun utilisateur</td></tr>` : users.map(u => `
              <tr>
                <td class="fw-600">${esc(u.name)}</td>
                <td class="text-muted">${esc(u.email)}</td>
                <td>
                  <select class="text-sm" style="padding:.25rem .5rem;border:1px solid var(--border);border-radius:4px" onchange="Admin.changeRole('${u.id}',this.value)">
                    <option value="student" ${u.role==='student'?'selected':''}>Étudiant</option>
                    <option value="teacher" ${u.role==='teacher'?'selected':''}>Enseignant</option>
                    <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
                  </select>
                </td>
                <td class="text-sm text-muted">${new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                <td>
                  <button class="btn btn-danger btn-sm" onclick="Admin.deleteUser('${u.id}','${esc(u.name)}')">🗑</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function listsTabHtml() {
    const lists = state.lists;
    return `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Titre</th><th>Propriétaire</th><th>Questions</th><th>Visibilité</th><th>Créée le</th><th>Actions</th></tr></thead>
          <tbody>
            ${lists.length === 0 ? `<tr><td colspan="6" class="text-sm text-muted">Aucune liste</td></tr>` : lists.map(l => `
              <tr>
                <td class="fw-600">${esc(l.title)}</td>
                <td class="text-muted">${esc(l.owner_name)}</td>
                <td>${l.question_count}</td>
                <td><span class="badge ${l.is_public ? 'badge-green' : 'badge-blue'}">${l.is_public ? 'Publique' : 'Privée'}</span></td>
                <td class="text-sm text-muted">${new Date(l.created_at).toLocaleDateString('fr-FR')}</td>
                <td>
                  <button class="btn btn-danger btn-sm" onclick="Admin.deleteList('${l.id}','${esc(l.title)}')">🗑</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function classesTabHtml() {
    const classes = state.classes;
    return `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Nom</th><th>Enseignant</th><th>Étudiants</th><th>Code</th><th>Créée le</th><th>Actions</th></tr></thead>
          <tbody>
            ${classes.length === 0 ? `<tr><td colspan="6" class="text-sm text-muted">Aucune classe</td></tr>` : classes.map(c => `
              <tr>
                <td class="fw-600">${esc(c.name)}</td>
                <td class="text-muted">${esc(c.teacher_name)}</td>
                <td>${c.member_count}</td>
                <td><span class="badge badge-blue">${esc(c.invite_code)}</span></td>
                <td class="text-sm text-muted">${new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                <td>
                  <button class="btn btn-danger btn-sm" onclick="Admin.deleteClass('${c.id}','${esc(c.name)}')">🗑</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function sessionsTabHtml() {
    const sessions = state.sessions;
    return `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Étudiant</th><th>Liste</th><th>Classe</th><th>Score</th><th>Statut</th><th>Démarré le</th></tr></thead>
          <tbody>
            ${sessions.length === 0 ? `<tr><td colspan="6" class="text-sm text-muted">Aucun quiz</td></tr>` : sessions.map(s => `
              <tr>
                <td><div class="fw-600">${esc(s.student_name)}</div><div class="text-sm text-muted">${esc(s.student_email)}</div></td>
                <td>${esc(s.list_title)}</td>
                <td class="text-muted">${s.class_name ? esc(s.class_name) : '—'}</td>
                <td>${s.score == null ? '—' : `<span class="badge ${s.score >= 80 ? 'badge-green' : s.score >= 60 ? 'badge-blue' : 'badge-red'}">${s.score}%</span>`}</td>
                <td><span class="badge ${s.completed_at ? 'badge-green' : 'badge-blue'}">${s.completed_at ? 'Terminé' : 'En cours'}</span></td>
                <td class="text-sm text-muted">${new Date(s.started_at).toLocaleDateString('fr-FR')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function changeRole(userId, role) {
    try { await API.adminUpdateRole(userId, role); Toast.success('Rôle mis à jour'); load(); }
    catch (err) { Toast.error(err.message); load(); }
  }

  async function deleteUser(userId, name) {
    Modal.confirm(`Supprimer l'utilisateur "${name}" ? Cette action est irréversible.`, async () => {
      try { await API.adminDeleteUser(userId); Toast.success('Utilisateur supprimé'); load(); }
      catch (err) { Toast.error(err.message); }
    });
  }

  async function deleteList(listId, title) {
    Modal.confirm(`Supprimer la liste "${title}" ? Cette action est irréversible.`, async () => {
      try { await API.deleteList(listId); Toast.success('Liste supprimée'); load(); }
      catch (err) { Toast.error(err.message); }
    });
  }

  async function deleteClass(classId, name) {
    Modal.confirm(`Supprimer la classe "${name}" ? Les étudiants perdront accès.`, async () => {
      try { await API.deleteClass(classId); Toast.success('Classe supprimée'); load(); }
      catch (err) { Toast.error(err.message); }
    });
  }

  return { load, switchTab, setSearch, setRoleFilter, changeRole, deleteUser, deleteList, deleteClass };
})();
