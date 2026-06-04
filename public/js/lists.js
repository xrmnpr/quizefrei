const Lists = (() => {
  let allLists = [];
  let currentTab = 'mine';

  function cardHtml(l, user) {
    const isMine = l.owner_id === user.id;
    const isPublic = l.is_public;
    return `
      <div class="list-card" onclick="Lists.openDetail('${l.id}')">
        <div class="list-card-header">
          <div class="list-card-title">${esc(l.title)}</div>
          <div style="display:flex;gap:.4rem;flex-shrink:0">
            ${isPublic ? '<span class="badge badge-green">Public</span>' : '<span class="badge badge-gray">Privé</span>'}
          </div>
        </div>
        ${l.description ? `<div class="list-card-desc">${esc(l.description)}</div>` : ''}
        <div class="list-card-meta">
          <span>📝 ${l.question_count} question${l.question_count !== 1 ? 's' : ''}</span>
          <span>👤 ${esc(l.owner_name)}</span>
        </div>
        <div class="list-card-actions">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();Quiz.start('${l.id}')">▶ Pratiquer</button>
          ${isMine ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();Lists.openDetail('${l.id}')">✏ Modifier</button>` : ''}
        </div>
      </div>`;
  }

  async function load() {
    const grid = document.getElementById('listsGrid');
    grid.innerHTML = '<div class="loading"><div class="spinner"></div>Chargement...</div>';
    try {
      allLists = await API.getLists();
      render();
    } catch (e) { grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-title">Erreur de chargement</div></div>`; }
  }

  function render() {
    const user = App.getUser();
    let filtered = allLists;

    if (currentTab === 'mine') filtered = allLists.filter(l => l.owner_id === user.id);
    else if (currentTab === 'shared') filtered = allLists.filter(l => l.owner_id !== user.id && !l.is_public);
    else if (currentTab === 'public') filtered = allLists.filter(l => l.is_public && l.owner_id !== user.id);

    const q = document.querySelector('.search-input')?.value?.toLowerCase() || '';
    if (q) filtered = filtered.filter(l => l.title.toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q));

    const grid = document.getElementById('listsGrid');
    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📋</div><div class="empty-title">Aucune liste</div><div class="empty-text">${currentTab === 'mine' ? 'Créez votre première liste !' : 'Aucune liste disponible'}</div></div>`;
      return;
    }
    grid.innerHTML = filtered.map(l => cardHtml(l, user)).join('');
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
      b.classList.toggle('active', ['mine', 'shared', 'public'][i] === tab);
    });
    render();
  }

  function filter(q) { render(); }

  function showCreate() {
    Modal.show(`
      <h2 style="margin-bottom:1.5rem">Nouvelle liste</h2>
      <form id="createListForm">
        <div class="form-group"><label>Titre *</label><input type="text" name="title" required placeholder="Ex: Algorithmes - Tri"></div>
        <div class="form-group"><label>Description</label><textarea name="description" rows="3" placeholder="Description optionnelle"></textarea></div>
        <div class="form-group">
          <label class="form-check"><input type="checkbox" name="is_public"> Rendre cette liste publique</label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="Modal.close()">Annuler</button>
          <button type="submit" class="btn btn-primary">Créer</button>
        </div>
      </form>
    `);
    document.getElementById('createListForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const list = await API.createList({
          title: fd.get('title'),
          description: fd.get('description') || null,
          is_public: fd.get('is_public') === 'on'
        });
        Modal.close();
        Toast.success('Liste créée !');
        await load();
        openDetail(list.id);
      } catch (err) { Toast.error(err.message); }
    };
  }

  async function openDetail(id) {
    App.navigate('list-detail');
    const content = document.getElementById('listDetailContent');
    const actions = document.getElementById('listActions');
    content.innerHTML = '<div class="loading"><div class="spinner"></div>Chargement...</div>';
    actions.innerHTML = '';

    try {
      const list = await API.getList(id);
      const user = App.getUser();
      const isMine = list.owner_id === user.id || user.role === 'admin';

      actions.innerHTML = `
        <button class="btn btn-primary" onclick="Quiz.start('${id}')">▶ Lancer le quiz</button>
        ${isMine ? `
          <button class="btn btn-outline" onclick="Lists.showEditList('${id}')">✏ Modifier</button>
          <button class="btn btn-outline" onclick="Lists.addQuestion('${id}')">+ Question</button>
          <button class="btn btn-outline" onclick="Lists.showShare('${id}')">⇗ Partager</button>
          <button class="btn btn-danger btn-sm" onclick="Lists.deleteList('${id}')">🗑</button>
        ` : ''}
      `;

      renderDetail(list, isMine);
    } catch { content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-title">Erreur</div></div>`; }
  }

  function renderDetail(list, isMine) {
    const content = document.getElementById('listDetailContent');
    const questionsHtml = list.questions.length === 0
      ? `<div class="empty-state"><div class="empty-icon">❓</div><div class="empty-title">Aucune question</div><div class="empty-text">Ajoutez des questions à cette liste</div></div>`
      : list.questions.map((q, i) => questionHtml(q, i, list.id, isMine)).join('');

    content.innerHTML = `
      <div class="list-detail-header">
        <div class="list-detail-title">${esc(list.title)}</div>
        ${list.description ? `<p style="color:var(--text-muted);margin-bottom:.75rem">${esc(list.description)}</p>` : ''}
        <div class="list-detail-meta">
          <span>📝 ${list.questions.length} question${list.questions.length !== 1 ? 's' : ''}</span>
          <span>👤 ${esc(list.owner_name)}</span>
          <span>${list.is_public ? '🌐 Public' : '🔒 Privé'}</span>
        </div>
      </div>
      <div class="questions-list">${questionsHtml}</div>
    `;
  }

  function questionHtml(q, i, listId, isMine) {
    const typeLabels = { multiple_choice: 'Choix multiple', true_false: 'Vrai/Faux', short_answer: 'Réponse libre' };
    const choicesHtml = q.choices.map(c => `
      <div class="choice-item ${c.is_correct ? 'is-correct' : ''}">
        ${c.is_correct ? '<span class="correct-mark">✓</span>' : ''}
        ${esc(c.choice_text)}
      </div>
    `).join('');

    return `
      <div class="question-card" id="q-${q.id}">
        <div class="question-header">
          <div>
            <div class="question-number">Question ${i + 1} • <span class="badge badge-blue">${typeLabels[q.question_type] || q.question_type}</span></div>
            <div class="question-text">${esc(q.question_text)}</div>
          </div>
          ${isMine ? `<div style="display:flex;gap:.4rem;flex-shrink:0">
            <button class="btn btn-outline btn-sm" onclick="Lists.editQuestion('${listId}','${q.id}')">✏</button>
            <button class="btn btn-danger btn-sm" onclick="Lists.deleteQuestion('${listId}','${q.id}')">🗑</button>
          </div>` : ''}
        </div>
        ${q.choices.length ? `<div class="choices-grid">${choicesHtml}</div>` : ''}
        ${q.question_type === 'short_answer' ? '<div style="margin-top:.75rem;font-size:.8rem;color:var(--text-muted)">Réponse texte libre</div>' : ''}
      </div>`;
  }

  function showEditList(id) {
    const list = { id };
    API.getList(id).then(l => {
      Modal.show(`
        <h2 style="margin-bottom:1.5rem">Modifier la liste</h2>
        <form id="editListForm">
          <div class="form-group"><label>Titre *</label><input type="text" name="title" required value="${esc(l.title)}"></div>
          <div class="form-group"><label>Description</label><textarea name="description" rows="3">${esc(l.description || '')}</textarea></div>
          <div class="form-group">
            <label class="form-check"><input type="checkbox" name="is_public" ${l.is_public ? 'checked' : ''}> Rendre publique</label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline" onclick="Modal.close()">Annuler</button>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      `);
      document.getElementById('editListForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await API.updateList(id, { title: fd.get('title'), description: fd.get('description') || null, is_public: fd.get('is_public') === 'on' });
          Modal.close(); Toast.success('Liste mise à jour !'); openDetail(id);
        } catch (err) { Toast.error(err.message); }
      };
    });
  }

  function addQuestion(listId) { showQuestionForm(listId, null); }
  function editQuestion(listId, qId) {
    API.getList(listId).then(l => {
      const q = l.questions.find(q => q.id === qId);
      if (q) showQuestionForm(listId, q);
    });
  }

  function showQuestionForm(listId, existing) {
    const isEdit = !!existing;
    const type = existing?.question_type || 'multiple_choice';
    Modal.show(`
      <h2 style="margin-bottom:1.5rem">${isEdit ? 'Modifier' : 'Ajouter'} une question</h2>
      <form id="questionForm">
        <div class="form-group">
          <label>Type de question</label>
          <select name="question_type" onchange="Lists.updateQuestionType(this.value)">
            <option value="multiple_choice" ${type === 'multiple_choice' ? 'selected' : ''}>Choix multiple</option>
            <option value="true_false" ${type === 'true_false' ? 'selected' : ''}>Vrai / Faux</option>
            <option value="short_answer" ${type === 'short_answer' ? 'selected' : ''}>Réponse libre</option>
          </select>
        </div>
        <div class="form-group">
          <label>Question *</label>
          <textarea name="question_text" required rows="3" placeholder="Entrez votre question...">${esc(existing?.question_text || '')}</textarea>
        </div>
        <div id="choicesContainer"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="Modal.close()">Annuler</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    `, true);

    window._currentQuestion = existing;
    Lists.updateQuestionType(type);

    document.getElementById('questionForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const qType = fd.get('question_type');
      let choices = [];

      if (qType === 'true_false') {
        const correct = fd.get('tf_correct');
        choices = [
          { choice_text: 'Vrai', is_correct: correct === 'true' },
          { choice_text: 'Faux', is_correct: correct === 'false' }
        ];
      } else if (qType === 'multiple_choice') {
        const texts = fd.getAll('choice_text');
        const corrects = fd.getAll('is_correct[]');
        choices = texts.map((t, i) => ({ choice_text: t, is_correct: corrects.includes(String(i)) }));
        if (!choices.some(c => c.is_correct)) { Toast.error('Sélectionnez au moins une bonne réponse'); return; }
        if (choices.some(c => !c.choice_text.trim())) { Toast.error('Tous les choix doivent avoir un texte'); return; }
      }

      try {
        const data = { question_text: fd.get('question_text'), question_type: qType, choices };
        if (isEdit) await API.updateQuestion(listId, existing.id, data);
        else await API.addQuestion(listId, data);
        Modal.close(); Toast.success(isEdit ? 'Question mise à jour !' : 'Question ajoutée !');
        openDetail(listId);
      } catch (err) { Toast.error(err.message); }
    };
  }

  function updateQuestionType(type) {
    const container = document.getElementById('choicesContainer');
    const existing = window._currentQuestion;
    if (!container) return;

    if (type === 'short_answer') {
      container.innerHTML = '<p class="text-sm text-muted" style="margin-bottom:1rem">Les étudiants saisiront leur réponse librement.</p>';
    } else if (type === 'true_false') {
      const curr = existing?.choices?.find(c => c.is_correct)?.choice_text?.toLowerCase();
      container.innerHTML = `
        <div class="form-group">
          <label>Bonne réponse</label>
          <div style="display:flex;gap:1rem">
            <label class="form-check"><input type="radio" name="tf_correct" value="true" ${curr === 'vrai' ? 'checked' : ''}> Vrai</label>
            <label class="form-check"><input type="radio" name="tf_correct" value="false" ${curr === 'faux' ? 'checked' : ''}> Faux</label>
          </div>
        </div>`;
    } else {
      const existingChoices = existing?.choices || [];
      const rows = existingChoices.length > 0 ? existingChoices : Array(4).fill(null);
      container.innerHTML = `
        <div class="form-group">
          <label>Choix <span class="text-muted text-sm">(cochez la/les bonne(s) réponse(s))</span></label>
          <div id="choicesList" style="display:flex;flex-direction:column;gap:.5rem">
            ${rows.map((c, i) => `
              <div style="display:flex;align-items:center;gap:.5rem">
                <input type="checkbox" name="is_correct[]" value="${i}" ${c?.is_correct ? 'checked' : ''}>
                <input type="text" name="choice_text" placeholder="Choix ${i + 1}" value="${esc(c?.choice_text || '')}" style="flex:1;padding:.5rem .75rem;border:1px solid var(--border);border-radius:6px;font-size:.875rem">
              </div>
            `).join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" style="margin-top:.5rem" onclick="Lists.addChoiceRow()">+ Ajouter un choix</button>
        </div>`;
    }
  }

  function addChoiceRow() {
    const list = document.getElementById('choicesList');
    if (!list) return;
    const i = list.children.length;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:.5rem';
    div.innerHTML = `<input type="checkbox" name="is_correct[]" value="${i}"><input type="text" name="choice_text" placeholder="Choix ${i + 1}" style="flex:1;padding:.5rem .75rem;border:1px solid var(--border);border-radius:6px;font-size:.875rem">`;
    list.appendChild(div);
  }

  async function deleteQuestion(listId, qId) {
    Modal.confirm('Supprimer cette question ?', async () => {
      try { await API.deleteQuestion(listId, qId); Toast.success('Question supprimée'); openDetail(listId); }
      catch (err) { Toast.error(err.message); }
    });
  }

  async function deleteList(id) {
    Modal.confirm('Supprimer définitivement cette liste et toutes ses questions ?', async () => {
      try {
        await API.deleteList(id);
        Toast.success('Liste supprimée');
        App.navigate('lists');
        load();
      } catch (err) { Toast.error(err.message); }
    });
  }

  async function showShare(listId) {
    let shares = [];
    try { shares = await API.getShares(listId); } catch {}
    Modal.show(`
      <h2 style="margin-bottom:1.5rem">Partager la liste</h2>
      <div class="form-group">
        <label>Partager avec (email)</label>
        <div style="display:flex;gap:.5rem">
          <input type="email" id="shareEmail" placeholder="email@efrei.net" style="flex:1;padding:.625rem .875rem;border:1px solid var(--border);border-radius:6px;font-size:.875rem">
          <button class="btn btn-primary btn-sm" onclick="Lists.doShare('${listId}')">Partager</button>
        </div>
      </div>
      <div id="shareList">
        ${shares.length === 0 ? '<p class="text-sm text-muted">Aucun partage actif</p>' : shares.map(s => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
            <div><div class="fw-600">${esc(s.name)}</div><div class="text-sm text-muted">${esc(s.email)}</div></div>
            <button class="btn btn-danger btn-sm" onclick="Lists.removeShare('${listId}','${s.id}')">✕</button>
          </div>`).join('')}
      </div>
    `);
  }

  async function doShare(listId) {
    const email = document.getElementById('shareEmail')?.value;
    if (!email) return;
    try {
      await API.shareList(listId, email);
      Toast.success('Liste partagée !');
      showShare(listId);
    } catch (err) { Toast.error(err.message); }
  }

  async function removeShare(listId, userId) {
    try { await API.removeShare(listId, userId); Toast.success('Partage retiré'); showShare(listId); }
    catch (err) { Toast.error(err.message); }
  }

  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { load, render, switchTab, filter, showCreate, openDetail, showEditList, addQuestion, editQuestion, showQuestionForm, updateQuestionType, addChoiceRow, deleteQuestion, deleteList, showShare, doShare, removeShare };
})();
