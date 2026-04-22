(function () {
  const btn = document.getElementById('analyze-all-btn');
  const toast = document.getElementById('analyze-toast');
  if (!btn || !toast) return;

  function showToast(msg, kind) {
    toast.textContent = msg;
    toast.dataset.kind = kind || 'info';
    toast.hidden = false;
    setTimeout(function () { toast.hidden = true; }, 4500);
  }

  btn.addEventListener('click', async function () {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Analyse en cours…';
    try {
      const res = await fetch('/crm/api/analyze-all-pending', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        showToast(data.message || "Échec de l'analyse.", 'error');
        return;
      }
      if (data.error === 'missing_gemini_key') {
        showToast(data.message || 'Configure ta clé Gemini dans ton profil.', 'error');
        return;
      }
      if (data.already_running) {
        showToast('Une analyse est déjà en cours, réessaie dans un instant.', 'info');
        return;
      }
      if (data.analyzed > 0) {
        showToast(data.analyzed + ' message(s) analysé(s). Rechargement…', 'ok');
        setTimeout(function () { window.location.reload(); }, 900);
      } else {
        showToast('Aucun nouveau message à analyser (≤ 7 jours).', 'info');
      }
    } catch (e) {
      showToast('Erreur réseau : ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
})();
