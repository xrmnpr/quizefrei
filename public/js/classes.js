const Classes = (() => {
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  async function load() {
    const user = App.getUser();
    const grid = document.getElementById('classesGrid');
    const subtitle = document.getElementById('classesSubtitle');
    const actions = document.getElementById('classesHeaderActions');
    grid.innerHTML = '<div class="loading"><div class="spinner"></div>Chargement...</div>';

    if (user.role === 'teacher' || user.role === 'admin') {
      subtitle.textContent = 'Gérez vos classes';
      actions.innerHTML = `<button class="btn btn-primary" onclick="Classes.showCreate()">+ Nouvelle classe</button>`;
    } else {
      subtitle.textContent = 'Vos classes rejointes';
      actions.innerHTML = `<button class="btn btn-outline" onclick="Classes.showJoin()">Rejoindre une classe</button>`;
    }

    try {
      const classes = await API.getClasses();
      if (!classes.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">🏫</div>
          <div class="empty-title">${user.role === 'teacher' ? 'Aucune classe créée' : 'Aucune classe rejointe'}</div>
          <div class="empty-text">${user.role === 'teacher' ? 'Créez votre première classe !' : 'Rejoignez une classe avec un code.'}</div>
        </div>`;
        return;
      }
      grid.innerHTML = classes.map(c => classCardHtml(c, user)).join('');
    } catch (e) { grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-title">Erreur</div></div>`; }
  }

  function classCardHtml(c, user) {
    return `
      <div class="class-card" onclick="Classes.openDetail('${c.id}')">
        <div class="class-card-title">${esc(c.name)}</div>
        <div class="class-card-meta">
          ${c.teacher_name ? `👨‍🏫 ${esc(c.teacher_name)} · ` : ''}
          👥 ${c.member_count} étudiant${c.member_count !== 1 ? 's' : ''}
        </div>
        ${c.description ? `<p class="text-sm text-muted">${esc(c.description)}</p>` : ''}
        ${(user.role === 'teacher' || user.role === 'admin') ? `
          <div style="margin-top:1rem">
            <span class="badge badge-blue">Code : ${esc(c.invite_code)}</span>
          </div>` : ''}
      </div>`;
  }

  async function openDetail(id) {
    App.navigate('class-detail');
    document.getElementById('classDetailContent').innerHTML = '<div class="loading"><div class="spinner"></div>Chargement...</div>';

    try {
      const cls = await API.getClass(id);
      const user = App.getUser();
      const isTeacher = cls.teacher_id === user.id || user.role === 'admin';
      renderClassDetail(cls, isTeacher);
    } catch { document.getElementById('classDetailContent').innerHTML = '<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-title">Erreur</div></div>'; }
  }

  function renderClassDetail(cls, isTeacher) {
    const actions = document.getElementById('classDetailActions');
    actions.innerHTML = isTeacher ? `
      <button class="btn btn-outline" onclick="Classes.addListToClass('${cls.id}')">+ Ajouter liste</button>
      <button class="btn btn-outline" onclick="Classes.showEditClass('${cls.id}')">✏ Modifier</button>
      <button class="btn btn-danger btn-sm" onclick="Classes.deleteClass('${cls.id}')">🗑</button>
    ` : '';

    const membersHtml = cls.members.length === 0
      ? '<p class="text-sm text-muted">Aucun étudiant</p>'
      : cls.members.map(m => `
          <div class="member-item">
            <div><div class="member-name">${esc(m.name)}</div><div class="member-email">${esc(m.email)}</div></div>
            ${isTeacher ? `<button class="btn btn-danger btn-sm" onclick="Classes.removeMember('${cls.id}','${m.id}')">✕</button>` : ''}
          </div>`).join('');

    const listsHtml = cls.lists.length === 0
      ? '<p class="text-sm text-muted">Aucune liste ajoutée</p>'
      : cls.lists.map(l => `
          <div class="class-list-item">
            <div>
              <div class="fw-600">${esc(l.title)}</div>
              <div class="text-sm text-muted">${l.question_count} question${l.question_count !== 1 ? 's' : ''} · ${esc(l.owner_name)}</div>
            </div>
            <div style="display:flex;gap:.5rem">
              <button class="btn btn-primary btn-sm" onclick="Quiz.start('${l.id}','${cls.id}')">▶</button>
              ${isTeacher ? `<button class="btn btn-danger btn-sm" onclick="Classes.removeList('${cls.id}','${l.id}')">✕</button>` : ''}
            </div>
          </div>`).join('');

    document.getElementById('classDetailContent').innerHTML = `
      <div class="class-detail-header">
        <div class="class-detail-title">${esc(cls.name)}</div>
        ${cls.description ? `<p style="opacity:.85;margin-bottom:.5rem">${esc(cls.description)}</p>` : ''}
        <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:.875rem;opacity:.85">
          <span>👨‍🏫 ${esc(cls.teacher_name)}</span>
          <span>👥 ${cls.members.length} étudiant${cls.members.length !== 1 ? 's' : ''}</span>
          <span>📚 ${cls.lists.length} liste${cls.lists.length !== 1 ? 's' : ''}</span>
        </div>
        ${isTeacher ? `
          <div class="invite-code-block" style="margin-top:1rem">
            🔑 Code d'invitation : <span class="invite-code">${esc(cls.invite_code)}</span>
            <button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:none" onclick="Classes.copyCode('${cls.invite_code}')">Copier</button>
            <button class="btn btn-sm" style="background:rgba(255,255,255,.1);color:#fff;border:none;font-size:.75rem" onclick="Classes.regenerateCode('${cls.id}')">↻ Regénérer</button>
          </div>
        ` : `
          <div class="invite-code-block" style="margin-top:1rem">
            Code de classe : <span class="invite-code">${esc(cls.invite_code)}</span>
          </div>
        `}
      </div>

      ${isTeacher ? `
        <div style="margin-bottom:1rem">
          <button class="btn btn-outline btn-sm" onclick="Classes.showResults('${cls.id}')">📊 Résultats des quiz notés</button>
        </div>
      ` : ''}

      <div class="class-sections">
        <div class="class-section">
          <h3>👥 Étudiants (${cls.members.length})</h3>
          ${membersHtml}
        </div>
        <div class="class-section">
          <h3>📚 Listes (${cls.lists.length})</h3>
          ${listsHtml}
        </div>
      </div>
    `;
  }

  function showCreate() {
    Modal.show(`
      <h2 style="margin-bottom:1.5rem">Nouvelle classe</h2>
      <form id="createClassForm">
        <div class="form-group"><label>Nom de la classe *</label><input type="text" name="name" required placeholder="Ex: Algo - L2 Info"></div>
        <div class="form-group"><label>Description</label><textarea name="description" rows="3" placeholder="Description optionnelle"></textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="Modal.close()">Annuler</button>
          <button type="submit" class="btn btn-primary">Créer</button>
        </div>
      </form>
    `);
    document.getElementById('createClassForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await API.createClass({ name: fd.get('name'), description: fd.get('description') || null });
        Modal.close(); Toast.success('Classe créée !'); load();
      } catch (err) { Toast.error(err.message); }
    };
  }

  function showJoin() {
    Modal.show(`
      <h2 style="margin-bottom:1.5rem">Rejoindre une classe</h2>
      <p class="text-sm text-muted" style="margin-bottom:1rem">Demandez le code d'invitation à votre enseignant.</p>
      <form id="joinClassForm">
        <div class="form-group"><label>Code d'invitation</label><input type="text" name="code" required placeholder="Ex: AB12CD" style="text-transform:uppercase;letter-spacing:.1em;font-weight:600;font-size:1rem"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="Modal.close()">Annuler</button>
          <button type="submit" class="btn btn-primary">Rejoindre</button>
        </div>
      </form>
    `);
    document.getElementById('joinClassForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await API.joinClass(fd.get('code'));
        Modal.close(); Toast.success(`Vous avez rejoint "${res.class.name}" !`); load();
      } catch (err) { Toast.error(err.message); }
    };
  }

  function showEditClass(id) {
    API.getClass(id).then(cls => {
      Modal.show(`
        <h2 style="margin-bottom:1.5rem">Modifier la classe</h2>
        <form id="editClassForm">
          <div class="form-group"><label>Nom *</label><input type="text" name="name" required value="${esc(cls.name)}"></div>
          <div class="form-group"><label>Description</label><textarea name="description" rows="3">${esc(cls.description || '')}</textarea></div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline" onclick="Modal.close()">Annuler</button>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      `);
      document.getElementById('editClassForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await API.updateClass(id, { name: fd.get('name'), description: fd.get('description') || null });
          Modal.close(); Toast.success('Classe mise à jour !'); openDetail(id);
        } catch (err) { Toast.error(err.message); }
      };
    });
  }

  function deleteClass(id) {
    Modal.confirm('Supprimer cette classe ? Les étudiants perdront accès.', async () => {
      try { await API.deleteClass(id); Toast.success('Classe supprimée'); App.navigate('classes'); load(); }
      catch (err) { Toast.error(err.message); }
    });
  }

  function removeMember(classId, studentId) {
    Modal.confirm("Retirer cet étudiant de la classe ?", async () => {
      try { await API.removeMember(classId, studentId); Toast.success('Étudiant retiré'); openDetail(classId); }
      catch (err) { Toast.error(err.message); }
    });
  }

  async function addListToClass(classId) {
    let myLists = [];
    try { myLists = await API.getMyLists(); } catch {}
    Modal.show(`
      <h2 style="margin-bottom:1.5rem">Ajouter une liste à la classe</h2>
      ${myLists.length === 0 ? '<p class="text-muted">Vous n\'avez aucune liste.</p>' : `
        <div style="display:flex;flex-direction:column;gap:.5rem;max-height:300px;overflow-y:auto">
          ${myLists.map(l => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:.625rem .875rem;border:1px solid var(--border);border-radius:8px">
              <div><div class="fw-600">${esc(l.title)}</div><div class="text-sm text-muted">${l.question_count} questions</div></div>
              <button class="btn btn-primary btn-sm" onclick="Classes.doAddList('${classId}','${l.id}')">+</button>
            </div>`).join('')}
        </div>
      `}
      <div class="form-actions"><button class="btn btn-outline" onclick="Modal.close()">Fermer</button></div>
    `, true);
  }

  async function doAddList(classId, listId) {
    try { await API.addListToClass(classId, listId); Toast.success('Liste ajoutée !'); Modal.close(); openDetail(classId); }
    catch (err) { Toast.error(err.message); }
  }

  async function removeList(classId, listId) {
    Modal.confirm('Retirer cette liste de la classe ?', async () => {
      try { await API.removeListFromClass(classId, listId); Toast.success('Liste retirée'); openDetail(classId); }
      catch (err) { Toast.error(err.message); }
    });
  }

  async function copyCode(code) {
    try { await navigator.clipboard.writeText(code); Toast.success('Code copié !'); } catch { Toast.info('Code : ' + code); }
  }

  async function regenerateCode(classId) {
    Modal.confirm('Regénérer le code ? L\'ancien code ne fonctionnera plus.', async () => {
      try {
        const res = await API.regenerateCode(classId);
        Toast.success('Nouveau code : ' + res.invite_code);
        openDetail(classId);
      } catch (err) { Toast.error(err.message); }
    });
  }

  async function showResults(classId) {
    try {
      const results = await API.getClassResults(classId);
      Modal.show(`
        <h2 style="margin-bottom:1.5rem">Résultats des quiz notés</h2>
        ${results.length === 0 ? '<p class="text-muted">Aucun résultat pour l\'instant.</p>' : `
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Étudiant</th><th>Liste</th><th>Score</th><th>Date</th></tr></thead>
              <tbody>
                ${results.map(r => `
                  <tr>
                    <td><div class="fw-600">${esc(r.student_name)}</div><div class="text-sm text-muted">${esc(r.student_email)}</div></td>
                    <td>${esc(r.list_title)}</td>
                    <td><span class="badge ${r.score >= 80 ? 'badge-green' : r.score >= 60 ? 'badge-blue' : 'badge-red'}">${r.score}%</span></td>
                    <td class="text-sm text-muted">${new Date(r.completed_at).toLocaleDateString('fr-FR')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        `}
        <div class="form-actions"><button class="btn btn-outline" onclick="Modal.close()">Fermer</button></div>
      `, true);
    } catch (err) { Toast.error(err.message); }
  }

  return { load, openDetail, showCreate, showJoin, showEditClass, deleteClass, removeMember, addListToClass, doAddList, removeList, copyCode, regenerateCode, showResults };
})();
