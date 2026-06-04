const Admin = (() => {
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  async function load() {
    const content = document.getElementById('adminContent');
    content.innerHTML = '<div class="loading"><div class="spinner"></div>Chargement...</div>';
    try {
      const [stats, users] = await Promise.all([API.adminStats(), API.adminUsers()]);
      render(stats, users);
    } catch { content.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-title">Erreur</div></div>'; }
  }

  function render(stats, users) {
    document.getElementById('adminContent').innerHTML = `
      <div class="stats-row" style="margin-bottom:2rem">
        <div class="stat-card"><div class="stat-value">${stats.users}</div><div class="stat-label">Utilisateurs</div></div>
        <div class="stat-card"><div class="stat-value">${stats.students}</div><div class="stat-label">Étudiants</div></div>
        <div class="stat-card"><div class="stat-value">${stats.teachers}</div><div class="stat-label">Enseignants</div></div>
        <div class="stat-card"><div class="stat-value">${stats.lists}</div><div class="stat-label">Listes</div></div>
        <div class="stat-card"><div class="stat-value">${stats.classes}</div><div class="stat-label">Classes</div></div>
        <div class="stat-card"><div class="stat-value">${stats.completed_sessions}</div><div class="stat-label">Quiz terminés</div></div>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;box-shadow:var(--shadow)">
        <div class="section-header" style="margin-bottom:1rem">
          <h2>Gestion des utilisateurs</h2>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Nom</th><th>Email</th><th>Rôle</th><th>Inscrit le</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
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
      </div>
    `;
  }

  async function changeRole(userId, role) {
    try { await API.adminUpdateRole(userId, role); Toast.success('Rôle mis à jour'); }
    catch (err) { Toast.error(err.message); load(); }
  }

  async function deleteUser(userId, name) {
    Modal.confirm(`Supprimer l'utilisateur "${name}" ? Cette action est irréversible.`, async () => {
      try { await API.adminDeleteUser(userId); Toast.success('Utilisateur supprimé'); load(); }
      catch (err) { Toast.error(err.message); }
    });
  }

  return { load, changeRole, deleteUser };
})();
