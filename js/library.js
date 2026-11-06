/* =====================================================================
   Game library: builds every game tile from js/games.js.
   - "genres" layout: search + genre chips + one row per genre
   - "classic" layout: the original single grid with search + A-Z sort
   - favorites bar (shared), hover name box, full A-Z list
   ===================================================================== */
(function () {
  const GAMES = window.GAMES || [];
  const GENRES = window.GENRES || [];
  const byId = {};
  GAMES.forEach(g => { byId[g.id] = g; });
  const genreLabel = {};
  GENRES.forEach(g => { genreLabel[g.key] = g.label; });

  const FAV_KEY = 'favoriteGames';
  const MAX_FAVORITES = 10;
  // Old favorite ids (from before games.js) -> new ids
  const OLD_IDS = {
    'games': 'clusterrush', 'play.cplegacy.com': 'clubpenguin', 'crazycattle3d.github.io': 'crazycattle3d',
    'scribblers.bios-marcel.link': 'skribbl', '?skipmovie': 'simpsons', 'sadx.boingagames.workers.dev': 'sadx',
    'index.html': 'melee'
  };

  const isExternal = g => /^https?:\/\//i.test(g.url);
  const $ = id => document.getElementById(id);

  /* ---------------------------------------------------------------- tiles */

  function makeTile(g) {
    const a = document.createElement('a');
    a.className = 'game-tile';
    a.href = g.url;
    a.dataset.gameId = g.id;
    a.setAttribute('aria-label', g.name);

    const star = document.createElement('span');
    star.className = 'game-star';
    star.dataset.id = g.id;
    star.textContent = '☆';

    const img = document.createElement('img');
    img.src = g.img;
    img.alt = g.name;
    img.width = 96;
    img.height = 96;
    img.loading = 'lazy';
    img.decoding = 'async';

    a.appendChild(star);
    a.appendChild(img);
    if (isExternal(g)) {
      const ext = document.createElement('span');
      ext.className = 'tile-ext';
      ext.title = 'Opens on another website';
      ext.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i>';
      a.appendChild(ext);
    }
    return a;
  }

  /* ------------------------------------------------------------ favorites */

  function getFavorites() {
    let favs;
    try { favs = JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { favs = []; }
    const fixed = [...new Set(favs.map(id => OLD_IDS[id] || id))].filter(id => byId[id]);
    if (fixed.length !== favs.length || fixed.some((id, i) => id !== favs[i])) saveFavorites(fixed);
    return fixed;
  }
  function saveFavorites(favs) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (e) {}
  }

  function updateStars(favs) {
    document.querySelectorAll('.game-star').forEach(star => {
      const on = favs.includes(star.dataset.id);
      star.classList.toggle('favorited', on);
      star.textContent = on ? '★' : '☆';
      star.title = on ? 'Remove from favorites' : 'Add to favorites';
    });
  }

  function renderFavorites(favs) {
    const bar = $('favorites-bar');
    bar.innerHTML = '';
    if (!favs.length) {
      const msg = document.createElement('p');
      msg.className = 'favorites-empty';
      msg.textContent = 'Star a game to add it to favorites!';
      bar.appendChild(msg);
      return;
    }
    favs.forEach(id => bar.appendChild(makeTile(byId[id])));
  }

  function toggleFavorite(id) {
    let favs = getFavorites();
    if (favs.includes(id)) {
      favs = favs.filter(f => f !== id);
    } else {
      if (favs.length >= MAX_FAVORITES) {
        alert('You can only favorite up to ' + MAX_FAVORITES + ' games. Remove one first.');
        return;
      }
      favs.push(id);
    }
    saveFavorites(favs);
    renderFavorites(favs);
    updateStars(favs);
  }

  /* ------------------------------------------------------- launching games */

  function launch(g, e) {
    // Let ctrl/cmd/middle-click open a new tab like a normal link
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return;
    closeFullList();
    hideTip();
    if (isExternal(g)) {
      // Off-site games open normally; tell friends where you went
      if (window.Presence) Presence.noteExternal(g);
      return;
    }
    if (e) e.preventDefault();
    if (g.randomizer) {
      const normal = confirm('Press OK for Normal, Cancel for Randomizer.');
      openGame(normal ? g.url : g.url + 'random/');
    } else {
      openGame(g.url);
    }
  }

  document.addEventListener('click', function (e) {
    const star = e.target.closest('.game-star');
    if (star) {
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite(star.dataset.id);
      return;
    }
    const el = e.target.closest('[data-game-id]');
    if (!el) return;
    const g = byId[el.dataset.gameId];
    if (g) launch(g, e);
  });
  document.addEventListener('auxclick', function (e) {
    const el = e.target.closest('[data-game-id]');
    if (el && byId[el.dataset.gameId] && isExternal(byId[el.dataset.gameId]) && window.Presence) {
      Presence.noteExternal(byId[el.dataset.gameId]);
    }
  });

  /* ------------------------------------------------------ hover name box */

  const tip = document.createElement('div');
  tip.id = 'gameTip';
  tip.setAttribute('role', 'tooltip');
  let tipTimer = null, tipFor = null;

  function showTip(tile) {
    const g = byId[tile.dataset.gameId];
    if (!g) return;
    tip.textContent = g.name;
    tip.classList.add('show');
    const r = tile.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = r.top - th - 10;
    tip.classList.toggle('below', top < 6);
    if (top < 6) top = r.bottom + 10;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.setProperty('--arrow-x', (r.left + r.width / 2 - left) + 'px');
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipFor = null;
    tip.classList.remove('show');
  }

  document.addEventListener('mouseover', function (e) {
    const tile = e.target.closest('.game-tile');
    if (tile === tipFor) return;
    hideTip();
    if (!tile) return;
    tipFor = tile;
    tipTimer = setTimeout(() => { if (tipFor === tile) showTip(tile); }, 450);
  });
  document.addEventListener('scroll', hideTip, true);
  window.addEventListener('blur', hideTip);

  /* ------------------------------------------------------ genres layout */

  let activeGenre = 'all';

  function gamesIn(key) {
    return key === 'all' ? GAMES : GAMES.filter(g => g.genres.includes(key));
  }

  function buildChips() {
    const nav = $('libChips');
    const chips = [{ key: 'all', label: 'All', icon: 'fa-solid fa-border-all' }].concat(GENRES);
    chips.forEach(c => {
      const count = gamesIn(c.key).length;
      if (!count) return;
      const b = document.createElement('button');
      b.className = 'lib-chip';
      b.dataset.genre = c.key;
      b.innerHTML = '<i class="' + c.icon + '"></i><span></span><em>' + count + '</em>';
      b.querySelector('span').textContent = c.label;
      b.addEventListener('click', () => setGenre(c.key));
      nav.appendChild(b);
    });
  }

  function makeRow(title, icon, games, key) {
    const sec = document.createElement('section');
    sec.className = 'lib-row';
    const head = document.createElement('div');
    head.className = 'lib-row-head';
    head.innerHTML = '<h3><i class="' + icon + '"></i> <span></span> <em>' + games.length + '</em></h3>';
    head.querySelector('span').textContent = title;
    if (key) {
      const all = document.createElement('button');
      all.className = 'lib-see-all';
      all.innerHTML = 'See all <i class="fa-solid fa-chevron-right"></i>';
      all.addEventListener('click', () => { setGenre(key); $('library').scrollIntoView({ behavior: 'smooth' }); });
      head.appendChild(all);
    }

    const track = document.createElement('div');
    track.className = 'lib-track';
    const strip = document.createElement('div');
    strip.className = 'lib-strip';
    games.forEach(g => strip.appendChild(makeTile(g)));

    const prev = document.createElement('button');
    prev.className = 'lib-arrow prev';
    prev.setAttribute('aria-label', 'Scroll left');
    prev.textContent = '‹';
    const next = document.createElement('button');
    next.className = 'lib-arrow next';
    next.setAttribute('aria-label', 'Scroll right');
    next.textContent = '›';
    const page = dir => strip.scrollBy({ left: dir * strip.clientWidth * 0.85, behavior: 'smooth' });
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
    const arrows = () => {
      prev.classList.toggle('hidden', strip.scrollLeft < 12);
      next.classList.toggle('hidden', strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 12);
    };
    strip.addEventListener('scroll', arrows, { passive: true });
    requestAnimationFrame(arrows);
    window.addEventListener('resize', arrows);

    track.appendChild(prev);
    track.appendChild(strip);
    track.appendChild(next);
    sec.appendChild(head);
    sec.appendChild(track);
    return sec;
  }

  function buildRows() {
    const wrap = $('libRows');
    wrap.innerHTML = '';
    const recent = window.Stats ? Stats.top(12).map(s => byId[s.id]).filter(Boolean) : [];
    if (recent.length >= 2) wrap.appendChild(makeRow('Your most played', 'fa-solid fa-clock-rotate-left', recent, null));
    GENRES.forEach(gen => {
      const list = gamesIn(gen.key);
      if (list.length) wrap.appendChild(makeRow(gen.label, gen.icon, list, gen.key));
    });
  }

  function matches(g, q) {
    if (!q) return true;
    const hay = (g.name + ' ' + g.id).toLowerCase();
    return q.split(/\s+/).every(word => hay.includes(word));
  }

  function renderView() {
    const q = $('libSearch').value.toLowerCase().trim();
    $('libClear').hidden = !q;
    document.querySelectorAll('.lib-chip').forEach(c => c.classList.toggle('active', c.dataset.genre === activeGenre));

    const showRows = activeGenre === 'all' && !q;
    $('libRows').hidden = !showRows;
    $('libResults').hidden = showRows;
    if (showRows) return;

    const list = gamesIn(activeGenre).filter(g => matches(g, q));
    if (activeGenre !== 'all' && !q) list.sort((a, b) => a.name.localeCompare(b.name));
    const res = $('libResults');
    res.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'lib-results-head';
    const where = activeGenre === 'all' ? 'all games' : genreLabel[activeGenre];
    head.textContent = q
      ? list.length + (list.length === 1 ? ' result' : ' results') + ' for “' + $('libSearch').value.trim() + '” in ' + where
      : genreLabel[activeGenre] + ' · ' + list.length + ' games';
    res.appendChild(head);

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'lib-empty';
      empty.textContent = activeGenre !== 'all'
        ? 'Nothing here. Try searching All games instead.'
        : 'No games found. Got an idea? Suggest it with the Google form above!';
      res.appendChild(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'lib-grid';
    list.forEach(g => grid.appendChild(makeTile(g)));
    res.appendChild(grid);
    updateStars(getFavorites());
  }

  function setGenre(key) {
    activeGenre = key;
    renderView();
    const chip = document.querySelector('.lib-chip[data-genre="' + key + '"]');
    if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  /* ------------------------------------------------------ classic layout */

  let classicBuilt = false;
  function buildClassic() {
    if (classicBuilt) return;
    classicBuilt = true;
    const container = $('games');
    GAMES.forEach(g => container.appendChild(makeTile(g)));
    const items = Array.from(container.children);
    const input = $('gameSearch');
    const sortBtn = $('sortBtn');
    let sorted = false;

    input.addEventListener('input', function () {
      const value = this.value.toLowerCase().trim();
      items.forEach(item => {
        item.style.display = byId[item.dataset.gameId].name.toLowerCase().includes(value) ? '' : 'none';
      });
    });

    sortBtn.addEventListener('click', function () {
      sortBtn.classList.remove('pressed');
      void sortBtn.offsetWidth; // restart animation if clicked rapidly
      sortBtn.classList.add('pressed');
      sorted = !sorted;
      const order = sorted
        ? [...items].sort((a, b) => byId[a.dataset.gameId].name.toLowerCase().localeCompare(byId[b.dataset.gameId].name.toLowerCase()))
        : items;
      sortBtn.textContent = sorted ? 'Sort: A-Z' : 'Sort: Default';
      order.forEach(item => container.appendChild(item));
    });
    updateStars(getFavorites());
  }

  function applyLayout() {
    const layout = document.documentElement.getAttribute('data-layout');
    const bar = $('favorites-bar');
    if (layout === 'classic') {
      buildClassic();
      $('classicFavSlot').appendChild(bar);
    } else {
      $('libFavSlot').appendChild(bar);
    }
    hideTip();
  }

  /* ------------------------------------------------------ full game list */

  function sortName(n) { return n.replace(/^the\s+/i, '').toLowerCase(); }

  function buildFullList() {
    const list = $('fullList');
    if (list.childElementCount) return;
    const sorted = [...GAMES].sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)));
    const groups = {};
    sorted.forEach(g => {
      const c = sortName(g.name).charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(c) ? c : '#';
      (groups[letter] = groups[letter] || []).push(g);
    });
    const letters = Object.keys(groups).sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)));
    const jump = $('fullListJump');

    letters.forEach(letter => {
      const sec = document.createElement('div');
      sec.className = 'fl-group';
      sec.id = 'fl-' + (letter === '#' ? 'num' : letter);
      const h = document.createElement('h4');
      h.textContent = letter;
      sec.appendChild(h);
      groups[letter].forEach(g => {
        const row = document.createElement('a');
        row.className = 'fl-row';
        row.href = g.url;
        row.dataset.gameId = g.id;
        row.dataset.search = (g.name + ' ' + g.id).toLowerCase();
        const img = document.createElement('img');
        img.src = g.img; img.alt = ''; img.loading = 'lazy'; img.width = 32; img.height = 32;
        const name = document.createElement('span');
        name.className = 'fl-name';
        name.textContent = g.name;
        const tags = document.createElement('span');
        tags.className = 'fl-tags';
        tags.textContent = g.genres.map(k => genreLabel[k]).join(' · ');
        row.appendChild(img);
        row.appendChild(name);
        if (isExternal(g)) {
          const ext = document.createElement('i');
          ext.className = 'fa-solid fa-arrow-up-right-from-square fl-ext';
          ext.title = 'Opens on another website';
          row.appendChild(ext);
        }
        row.appendChild(tags);
        sec.appendChild(row);
      });
      list.appendChild(sec);

      const j = document.createElement('button');
      j.textContent = letter;
      j.addEventListener('click', () => {
        const target = document.getElementById(sec.id);
        $('fullList').scrollTo({ top: target.offsetTop - $('fullList').offsetTop, behavior: 'smooth' });
      });
      jump.appendChild(j);
    });
    $('fullListCount').textContent = GAMES.length;
  }

  function filterFullList() {
    const q = $('fullListSearch').value.toLowerCase().trim();
    document.querySelectorAll('#fullList .fl-group').forEach(sec => {
      let any = false;
      sec.querySelectorAll('.fl-row').forEach(r => {
        const show = !q || q.split(/\s+/).every(w => r.dataset.search.includes(w));
        r.hidden = !show;
        if (show) any = true;
      });
      sec.hidden = !any;
    });
  }

  function openFullList() {
    buildFullList();
    $('fullListOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('fullListSearch').focus(), 50);
  }
  function closeFullList() {
    const o = $('fullListOverlay');
    if (!o || !o.classList.contains('active')) return;
    o.classList.remove('active');
    document.body.style.overflow = '';
  }

  /* ---------------------------------------------------------------- init */

  function init() {
    document.body.appendChild(tip);
    buildChips();
    buildRows();
    renderView();
    applyLayout();
    const favs = getFavorites();
    renderFavorites(favs);
    updateStars(favs);

    $('libSearch').placeholder = 'Search ' + GAMES.length + ' games…';
    $('libSearch').addEventListener('input', renderView);
    $('libSearch').addEventListener('keydown', e => {
      if (e.key === 'Escape') { $('libSearch').value = ''; renderView(); }
    });
    $('libClear').addEventListener('click', () => { $('libSearch').value = ''; renderView(); $('libSearch').focus(); });

    $('fullListBtn').addEventListener('click', openFullList);
    $('classicFullListBtn').addEventListener('click', openFullList);
    $('fullListClose').addEventListener('click', closeFullList);
    $('fullListOverlay').addEventListener('click', e => { if (e.target.id === 'fullListOverlay') closeFullList(); });
    $('fullListSearch').addEventListener('input', filterFullList);

    // "/" jumps to search
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeFullList();
      if (e.key !== '/' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (document.querySelector('.settings-overlay-open, #gameOverlay.active')) return;
      e.preventDefault();
      const input = document.documentElement.getAttribute('data-layout') === 'classic' ? $('gameSearch') : $('libSearch');
      input.focus();
    });

    document.addEventListener('boinga:layout', applyLayout);
    document.addEventListener('boinga:gameclose', () => {
      // refresh "Your most played" so it reflects what you just played
      if (activeGenre === 'all') { buildRows(); updateStars(getFavorites()); }
    });
  }

  window.Library = { byId: byId, launch: launch, openFullList: openFullList };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
