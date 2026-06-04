const Quiz = (() => {
  let session = null;
  let questions = [];
  let currentIndex = 0;
  let responses = {};
  let timerInterval = null;
  let timeLeft = 0;

  function start(listId, classId, timeLimit, isGraded) {
    Modal.show(`
      <h2 style="margin-bottom:1rem">Paramètres du quiz</h2>
      <form id="quizSettingsForm">
        <div class="form-group">
          <label>Limite de temps (minutes)</label>
          <input type="number" name="time_limit" min="1" max="180" placeholder="Sans limite" value="${timeLimit || ''}">
          <div class="text-sm text-muted" style="margin-top:.3rem">Laissez vide pour pas de limite</div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="Modal.close()">Annuler</button>
          <button type="submit" class="btn btn-primary">▶ Commencer</button>
        </div>
      </form>
    `);
    document.getElementById('quizSettingsForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tl = parseInt(fd.get('time_limit'));
      Modal.close();
      await launchQuiz(listId, classId, isNaN(tl) ? null : tl * 60, isGraded);
    };
  }

  async function launchQuiz(listId, classId, timeLimitSeconds, isGraded) {
    try {
      const data = await API.startSession({ list_id: listId, class_id: classId || null, time_limit: timeLimitSeconds, is_graded: isGraded || false });
      session = { id: data.session_id, listTitle: data.list_title };
      questions = data.questions;
      currentIndex = 0;
      responses = {};
      timeLeft = timeLimitSeconds;

      App.navigate('quiz');
      renderQuestion();
      if (timeLimitSeconds) startTimer();
    } catch (err) { Toast.error(err.message); }
  }

  function startTimer() {
    clearInterval(timerInterval);
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      timeLeft--;
      updateTimerDisplay();
      if (timeLeft <= 0) { clearInterval(timerInterval); submitQuiz(); }
    }, 1000);
  }

  function updateTimerDisplay() {
    const el = document.getElementById('quizTimer');
    if (!el) return;
    const m = Math.floor(Math.abs(timeLeft) / 60);
    const s = Math.abs(timeLeft) % 60;
    el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    el.className = 'quiz-timer' + (timeLeft <= 30 ? ' urgent' : '');
  }

  function renderQuestion() {
    const q = questions[currentIndex];
    const progress = ((currentIndex + 1) / questions.length) * 100;
    const answered = Object.keys(responses).length;

    const timerHtml = timeLeft !== null && timeLeft !== undefined
      ? `<span id="quizTimer" class="quiz-timer"></span>`
      : '';

    document.getElementById('quizContent').innerHTML = `
      <div class="quiz-container">
        <div class="quiz-header">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
            <div>
              <div style="font-weight:600">${esc(session.listTitle)}</div>
              <div class="text-sm text-muted">Question ${currentIndex + 1} / ${questions.length} • ${answered} répondue${answered > 1 ? 's' : ''}</div>
            </div>
            ${timerHtml}
          </div>
          <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${progress}%"></div></div>
        </div>

        ${renderQuestionCard(q)}

        <div class="quiz-nav">
          <button class="btn btn-outline" onclick="Quiz.prev()" ${currentIndex === 0 ? 'disabled' : ''}>← Précédent</button>
          <div style="display:flex;gap:.5rem">
            ${questions.map((_, i) => `
              <button onclick="Quiz.goTo(${i})" style="width:32px;height:32px;border-radius:50%;border:2px solid ${i === currentIndex ? 'var(--primary)' : (responses[questions[i].id] !== undefined ? 'var(--success)' : 'var(--border)')};background:${i === currentIndex ? 'var(--primary)' : (responses[questions[i].id] !== undefined ? '#f0fff4' : 'var(--surface)')};color:${i === currentIndex ? '#fff' : 'var(--text)'};font-size:.75rem;font-weight:600;cursor:pointer">${i + 1}</button>
            `).join('')}
          </div>
          ${currentIndex < questions.length - 1
            ? `<button class="btn btn-primary" onclick="Quiz.next()">Suivant →</button>`
            : `<button class="btn btn-primary" onclick="Quiz.submitQuiz()">Terminer ✓</button>`}
        </div>
      </div>
    `;

    if (timeLeft !== null && timeLeft !== undefined && timerInterval) updateTimerDisplay();
  }

  function renderQuestionCard(q) {
    const resp = responses[q.id];
    if (q.question_type === 'short_answer') {
      return `
        <div class="quiz-question-card">
          <div class="quiz-q-number">Question ${currentIndex + 1}</div>
          <div class="quiz-q-text">${esc(q.question_text)}</div>
          <textarea class="quiz-text-input" placeholder="Votre réponse..." oninput="Quiz.setTextResponse('${q.id}', this.value)">${esc(resp?.text || '')}</textarea>
        </div>`;
    }

    const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
    return `
      <div class="quiz-question-card">
        <div class="quiz-q-number">Question ${currentIndex + 1}</div>
        <div class="quiz-q-text">${esc(q.question_text)}</div>
        <div class="quiz-choices">
          ${q.choices.map((c, i) => `
            <div class="quiz-choice ${resp?.choice_id === c.id ? 'selected' : ''}" onclick="Quiz.selectChoice('${q.id}','${c.id}')">
              <span class="quiz-choice-key">${keys[i] || i + 1}</span>
              ${esc(c.choice_text)}
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function selectChoice(qId, choiceId) {
    responses[qId] = { choice_id: choiceId };
    renderQuestion();
  }

  function setTextResponse(qId, text) {
    responses[qId] = { text };
  }

  function next() { if (currentIndex < questions.length - 1) { currentIndex++; renderQuestion(); } }
  function prev() { if (currentIndex > 0) { currentIndex--; renderQuestion(); } }
  function goTo(i) { currentIndex = i; renderQuestion(); }

  async function submitQuiz() {
    clearInterval(timerInterval);
    const unanswered = questions.filter(q => responses[q.id] === undefined).length;
    if (unanswered > 0) {
      const ok = await new Promise(resolve => {
        Modal.confirm(`${unanswered} question${unanswered > 1 ? 's' : ''} sans réponse. Terminer quand même ?`, () => resolve(true));
        document.getElementById('confirmBtn').onclick = () => { Modal.close(); resolve(true); };
        setTimeout(() => {
          const btn = document.getElementById('confirmBtn');
          if (btn) btn.onclick = () => { Modal.close(); resolve(true); };
        }, 50);
      });
    }

    const responseList = questions.map(q => {
      const r = responses[q.id] || {};
      return { question_id: q.id, choice_id: r.choice_id || null, text_answer: r.text || null };
    });

    try {
      const result = await API.submitSession(session.id, responseList);
      showResults(result);
    } catch (err) { Toast.error(err.message); }
  }

  function showResults(result) {
    const pct = result.score !== null ? result.score : null;
    const style = pct !== null ? `--pct:${pct * 3.6}deg` : '';

    const getEmoji = (s) => s >= 80 ? '🎉' : s >= 60 ? '👍' : s >= 40 ? '😐' : '📚';
    const getMessage = (s) => s >= 80 ? 'Excellent !' : s >= 60 ? 'Bien joué !' : s >= 40 ? 'Continuez !' : 'À réviser !';

    document.getElementById('quizContent').innerHTML = `
      <div class="results-container">
        <div class="results-score-card">
          ${pct !== null ? `
            <div class="score-circle" style="${style}">
              <div class="score-circle-inner">
                <div class="score-pct">${pct}%</div>
                <div class="score-fraction">${result.correct}/${result.total}</div>
              </div>
            </div>
            <div class="results-title">${getEmoji(pct)} ${getMessage(pct)}</div>
            <div class="results-sub">${result.correct} bonne${result.correct > 1 ? 's' : ''} réponse${result.correct > 1 ? 's' : ''} sur ${result.total}</div>
          ` : `
            <div style="font-size:3rem;margin-bottom:1rem">✏</div>
            <div class="results-title">Quiz terminé</div>
            <div class="results-sub">Réponses libres soumises</div>
          `}
          <div style="margin-top:1.5rem;display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="Quiz.start('${questions[0]?.list_id || ''}')">Recommencer</button>
            <button class="btn btn-outline" onclick="App.navigate('lists')">Retour aux listes</button>
          </div>
        </div>

        <h3 style="margin-bottom:1rem;font-size:1rem;font-weight:600">Correction détaillée</h3>
        <div class="review-list">
          ${result.review.map((r, i) => reviewItemHtml(r, i)).join('')}
        </div>
      </div>
    `;
  }

  function reviewItemHtml(r, i) {
    let statusClass = '';
    let statusText = '';

    if (r.question_type === 'short_answer') {
      statusClass = '';
      statusText = `<div class="review-answer"><strong>Votre réponse :</strong> ${esc(r.my_text || '(aucune)')}</div>`;
    } else {
      const myChoice = r.correct_choices.some(c => c.id === r.my_choice_id);
      statusClass = myChoice ? 'correct' : 'wrong';
      const correctText = r.correct_choices.map(c => esc(c.choice_text)).join(', ');
      statusText = `<div class="review-answer text-${myChoice ? 'success' : 'danger'}">
        ${myChoice ? '✓ Bonne réponse' : `✗ Mauvaise réponse · Correct : ${correctText}`}
      </div>`;
    }

    return `
      <div class="review-item ${statusClass}">
        <div class="quiz-q-number text-muted text-sm">Question ${i + 1}</div>
        <div class="review-q">${esc(r.question_text)}</div>
        ${statusText}
      </div>`;
  }

  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { start, launchQuiz, next, prev, goTo, selectChoice, setTextResponse, submitQuiz };
})();
