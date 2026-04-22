(function () {
  const btn = document.getElementById('drafts-btn');
  const modal = document.getElementById('drafts-modal');
  if (!btn || !modal) return;

  const closeBtn = document.getElementById('drafts-close');
  const tabs = Array.from(modal.querySelectorAll('.drafts-tab'));
  const contentBox = document.getElementById('drafts-content');
  const useBtn = document.getElementById('drafts-use');
  const copyBtn = document.getElementById('drafts-copy');

  let drafts = null;
  let activeTone = 'professionnel';

  function openModal() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function renderActive() {
    if (!drafts) return;
    const text = drafts[activeTone] || '';
    contentBox.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'draft-body';
    pre.textContent = text;
    contentBox.appendChild(pre);
    useBtn.disabled = !text;
    copyBtn.disabled = !text;
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('is-active'); });
      tab.classList.add('is-active');
      activeTone = tab.dataset.tone;
      renderActive();
    });
  });

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  useBtn.addEventListener('click', function () {
    if (!drafts) return;
    const text = drafts[activeTone] || '';
    const url = new URL(btn.dataset.replyHref, window.location.origin);
    url.searchParams.set('draft', text);
    window.location.href = url.toString();
  });

  copyBtn.addEventListener('click', async function () {
    if (!drafts) return;
    const text = drafts[activeTone] || '';
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copié !';
      setTimeout(function () { copyBtn.textContent = 'Copier'; }, 1500);
    } catch (e) {
      copyBtn.textContent = 'Échec';
    }
  });

  btn.addEventListener('click', async function () {
    openModal();
    contentBox.innerHTML = '<div class="drafts-loading muted">Génération en cours…</div>';
    useBtn.disabled = true;
    copyBtn.disabled = true;
    drafts = null;

    const slug = btn.dataset.slug;
    const folder = btn.dataset.folder;
    const uid = btn.dataset.uid;
    const url = '/crm/api/messages/'
      + encodeURIComponent(slug) + '/'
      + encodeURIComponent(folder) + '/'
      + encodeURIComponent(uid) + '/drafts';

    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        contentBox.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'error';
        p.textContent = data.message || 'Impossible de générer les brouillons.';
        contentBox.appendChild(p);
        return;
      }
      drafts = data.drafts || {};
      renderActive();
    } catch (e) {
      contentBox.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = 'Erreur réseau : ' + e.message;
      contentBox.appendChild(p);
    }
  });
})();
