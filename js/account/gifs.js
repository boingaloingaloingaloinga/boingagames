/* GIF picker (KLIPY). GIFs only — no stickers or clips.
   window.GifPicker.open(anchorElement, gif => { ... })   gif = { url, w, h } */
(function () {
  const { h } = window.UI;
  const KEY = (window.BOINGA_CONFIG || {}).KLIPY_KEY || '';
  const BASE = 'https://api.klipy.com/api/v1/' + encodeURIComponent(KEY) + '/gifs/';
  let panel = null;

  function pickFile(item) {
    const f = item.file || {};
    // A medium-size animated file keeps chats light
    const order = [['md', 'webp'], ['md', 'gif'], ['sm', 'webp'], ['sm', 'gif'], ['hd', 'webp'], ['hd', 'gif']];
    for (const [size, fmt] of order) {
      const x = f[size] && f[size][fmt];
      if (x && x.url) return { url: x.url, w: x.width, h: x.height };
    }
    return null;
  }
  function previewFile(item) {
    const f = item.file || {};
    const x = (f.sm && (f.sm.webp || f.sm.gif)) || (f.md && (f.md.webp || f.md.gif));
    return x ? x.url : '';
  }

  async function fetchGifs(q, page) {
    const params = new URLSearchParams({ page: String(page), per_page: '24', locale: 'en_US' });
    if (window.Account && Account.user) params.set('customer_id', 'boinga-' + Account.user.id);
    if (q) params.set('q', q);
    const r = await fetch(BASE + (q ? 'search' : 'trending') + '?' + params.toString());
    if (!r.ok) throw new Error('GIF search is having trouble right now.');
    const j = await r.json();
    const d = j.data || {};
    return { items: (d.data || []).filter(i => i.type === 'gif'), hasNext: !!d.has_next };
  }

  function close() {
    if (panel) { panel.remove(); panel = null; }
    document.removeEventListener('mousedown', outside, true);
  }
  function outside(e) {
    if (panel && !panel.contains(e.target) && !e.target.closest('.chat-gif-btn')) close();
  }

  function open(anchor, onPick) {
    if (panel) { close(); return; }
    if (!KEY) { UI.toast('GIFs are not set up yet (missing KLIPY key).', 'bad'); return; }
    const input = h('input', { type: 'search', class: 'gif-search', placeholder: 'Search KLIPY', maxlength: 60, spellcheck: 'false' });
    const grid = h('div', { class: 'gif-grid' });
    const status = h('div', { class: 'gif-status' }, 'Loading…');
    const scroller = h('div', { class: 'gif-scroll' }, grid, status);
    panel = h('div', { class: 'gif-panel', role: 'dialog', 'aria-label': 'Pick a GIF' },
      h('div', { class: 'gif-top' }, input, h('button', { class: 'gif-x', title: 'Close', onclick: close }, '×')),
      scroller,
      h('div', { class: 'gif-credit' }, 'Powered by ', h('strong', null, 'KLIPY')));
    anchor.closest('.chat-compose').appendChild(panel);
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);

    let q = '', page = 1, hasNext = true, loading = false, seq = 0;
    async function load(reset) {
      if (loading && !reset) return;
      if (reset) { page = 1; hasNext = true; grid.innerHTML = ''; }
      if (!hasNext) return;
      loading = true;
      const mySeq = ++seq;
      status.textContent = 'Loading…';
      try {
        const r = await fetchGifs(q, page);
        if (mySeq !== seq) return;
        r.items.forEach(item => {
          const file = pickFile(item);
          const prev = previewFile(item);
          if (!file || !prev) return;
          const b = h('button', { class: 'gif-item', title: item.title || 'GIF' },
            h('img', { src: prev, alt: item.title || 'GIF', loading: 'lazy' }));
          b.addEventListener('click', () => { close(); onPick(file); });
          grid.appendChild(b);
        });
        hasNext = r.hasNext;
        page++;
        status.textContent = grid.childElementCount ? (hasNext ? '' : '') : 'No GIFs found.';
      } catch (e) {
        status.textContent = e.message;
      } finally { if (mySeq === seq) loading = false; }
    }
    let t = null;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = input.value.trim(); load(true); }, 350); });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    scroller.addEventListener('scroll', () => {
      if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 120) load(false);
    });
    load(true);
    setTimeout(() => input.focus(), 30);
  }

  window.GifPicker = { open, close };
})();
