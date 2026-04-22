(function () {
  const btn = document.getElementById('analyze-pending-btn');
  const toast = document.getElementById('analyze-toast');
  if (!btn || !toast) return;

  function showToast(msg, kind) {
    toast.textContent = msg;
    toast.dataset.kind = kind || 'info';
    toast.hidden = false;
    setTimeout(function () { toast.hidden = true; }, 4500);
  }

  btn.addEventListener('click', async function () {
    const slug = btn.dataset.slug;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Analyse en cours…';
    try {
      const res = await fetch(
        '/crm/api/mailbox/' + encodeURIComponent(slug) + '/analyze-pending',
        { method: 'POST', credentials: 'same-origin' }
      );
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        showToast(data.message || "Échec de l'analyse.", 'error');
        return;
      }
      if (data.analyzed > 0) {
        showToast(data.analyzed + ' message(s) analysé(s). Rechargement…', 'ok');
        setTimeout(function () { window.location.reload(); }, 800);
      } else if (data.already_running) {
        showToast('Une analyse est déjà en cours.', 'info');
      } else if (data.error === 'missing_gemini_key') {
        showToast(data.message || 'Configure ta clé Gemini dans ton profil.', 'error');
      } else {
        showToast('Aucun nouveau message à analyser.', 'info');
      }
    } catch (e) {
      showToast('Erreur réseau : ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
})();
