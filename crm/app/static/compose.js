(function () {
  const btn = document.getElementById('translate-btn');
  const undoBtn = document.getElementById('translate-undo-btn');
  const status = document.getElementById('translate-status');
  const textarea = document.getElementById('compose-body');
  if (!btn || !undoBtn || !status || !textarea) return;

  let previousValue = null;

  function setStatus(text, kind) {
    status.textContent = text || '';
    status.dataset.kind = kind || '';
    status.hidden = !text;
  }

  btn.addEventListener('click', async function () {
    const current = textarea.value;
    if (!current.trim()) {
      setStatus('Rien à traduire.', 'error');
      setTimeout(function () { setStatus('', ''); }, 2000);
      return;
    }

    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Traduction…';
    setStatus('Traduction en cours…', 'info');

    try {
      const res = await fetch('/crm/api/translate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: current }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setStatus(data.message || 'Échec de la traduction.', 'error');
        return;
      }
      if (!data.translated) {
        setStatus('Réponse vide du modèle.', 'error');
        return;
      }
      previousValue = current;
      textarea.value = data.translated;
      undoBtn.hidden = false;
      setStatus('Traduction terminée.', 'ok');
      setTimeout(function () { setStatus('', ''); }, 2500);
    } catch (e) {
      setStatus('Erreur réseau : ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  undoBtn.addEventListener('click', function () {
    if (previousValue === null) return;
    textarea.value = previousValue;
    previousValue = null;
    undoBtn.hidden = true;
    setStatus('Texte restauré.', 'info');
    setTimeout(function () { setStatus('', ''); }, 1500);
  });
})();
