(function () {
  const translateBtn = document.getElementById('translate-btn');
  const polishBtn = document.getElementById('polish-btn');
  const undoBtn = document.getElementById('compose-undo-btn');
  const status = document.getElementById('translate-status');
  const textarea = document.getElementById('compose-body');
  if (!undoBtn || !status || !textarea) return;

  // Shared undo buffer: whatever AI action (translate, polish) ran
  // last can be reverted via the same button.
  let previousValue = null;

  function setStatus(text, kind) {
    status.textContent = text || '';
    status.dataset.kind = kind || '';
    status.hidden = !text;
  }

  async function runAiAction(opts) {
    const current = textarea.value;
    if (!current.trim()) {
      setStatus(opts.emptyMsg, 'error');
      setTimeout(function () { setStatus('', ''); }, 2000);
      return;
    }

    opts.button.disabled = true;
    if (translateBtn) translateBtn.disabled = true;
    if (polishBtn) polishBtn.disabled = true;
    const originalLabel = opts.button.textContent;
    opts.button.textContent = opts.workingLabel;
    setStatus(opts.workingStatus, 'info');

    try {
      const res = await fetch(opts.url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: current }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setStatus(data.message || opts.failMsg, 'error');
        return;
      }
      const output = data[opts.responseKey];
      if (!output) {
        setStatus('Réponse vide du modèle.', 'error');
        return;
      }
      previousValue = current;
      textarea.value = output;
      undoBtn.hidden = false;
      setStatus(opts.doneMsg, 'ok');
      setTimeout(function () { setStatus('', ''); }, 2500);
    } catch (e) {
      setStatus('Erreur réseau : ' + e.message, 'error');
    } finally {
      opts.button.disabled = false;
      opts.button.textContent = originalLabel;
      if (translateBtn) translateBtn.disabled = false;
      if (polishBtn) polishBtn.disabled = false;
    }
  }

  if (translateBtn) {
    translateBtn.addEventListener('click', function () {
      runAiAction({
        button: translateBtn,
        url: '/crm/api/translate',
        responseKey: 'translated',
        emptyMsg: 'Rien à traduire.',
        workingLabel: 'Traduction…',
        workingStatus: 'Traduction en cours…',
        doneMsg: 'Traduction terminée.',
        failMsg: 'Échec de la traduction.',
      });
    });
  }

  if (polishBtn) {
    polishBtn.addEventListener('click', function () {
      runAiAction({
        button: polishBtn,
        url: '/crm/api/polish',
        responseKey: 'polished',
        emptyMsg: 'Rien à corriger.',
        workingLabel: 'Correction…',
        workingStatus: 'Relecture en cours…',
        doneMsg: 'Texte corrigé.',
        failMsg: 'Échec de la correction.',
      });
    });
  }

  undoBtn.addEventListener('click', function () {
    if (previousValue === null) return;
    textarea.value = previousValue;
    previousValue = null;
    undoBtn.hidden = true;
    setStatus('Texte restauré.', 'info');
    setTimeout(function () { setStatus('', ''); }, 1500);
  });
})();
