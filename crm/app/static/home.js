const HOME_TOAST = document.getElementById('analyze-toast');
function showHomeToast(msg, kind) {
  if (!HOME_TOAST) return;
  HOME_TOAST.textContent = msg;
  HOME_TOAST.dataset.kind = kind || 'info';
  HOME_TOAST.hidden = false;
  setTimeout(function () { HOME_TOAST.hidden = true; }, 4500);
}

(function () {
  const btn = document.getElementById('analyze-all-btn');
  if (!btn || !HOME_TOAST) return;

  function showToast(msg, kind) { showHomeToast(msg, kind); }

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

// Mark-as-done handlers for the "À traiter en priorité" list.
(function () {
  const rows = document.querySelectorAll('.urgent-row');
  if (!rows.length) return;

  rows.forEach(function (row) {
    const btn = row.querySelector('.btn-done');
    if (!btn) return;
    btn.addEventListener('click', async function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      const slug = row.dataset.slug;
      const folder = row.dataset.folder;
      const uid = row.dataset.uid;
      if (!slug || !folder || !uid) return;

      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '…';

      const url = '/crm/api/messages/'
        + encodeURIComponent(slug) + '/'
        + encodeURIComponent(folder) + '/'
        + encodeURIComponent(uid) + '/done';

      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!res.ok) {
          const data = await res.json().catch(function () { return {}; });
          showHomeToast(data.message || 'Impossible de marquer comme traité.', 'error');
          btn.disabled = false;
          btn.textContent = original;
          return;
        }
        row.classList.add('is-done');
        setTimeout(function () {
          row.remove();
          const ul = document.querySelector('.urgent-list');
          if (ul && !ul.querySelector('.urgent-row')) {
            const section = ul.closest('section');
            if (section) section.remove();
          }
        }, 250);
      } catch (e) {
        showHomeToast('Erreur réseau : ' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });
})();
