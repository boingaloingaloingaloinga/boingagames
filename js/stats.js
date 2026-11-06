/* Statistics: time on site + per-game playtime (saved in this browser).
   Exposes window.Stats = { gameOpened(url), gameClosed(), top(n) } */
(function () {
  const KEY = 'siteStats';
  const AWAY_CAP = 120; // seconds of off-tab time that still count

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && d.games) return d;
    } catch (e) {}
    return { siteTime: 0, totalOpens: 0, games: {} };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  const data = load();
  let currentId = null;
  let hiddenAt = null;
  let ticks = 0;

  function addTime(sec) {
    data.siteTime += sec;
    if (currentId && data.games[currentId]) data.games[currentId].time += sec;
  }

  // Count a second whenever the tab is visible (playing a game counts too)
  setInterval(function () {
    if (document.visibilityState === 'visible') {
      addTime(1);
      if (++ticks % 5 === 0) save();
    }
  }, 1000);

  // Off-tab time only counts up to AWAY_CAP seconds
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      save();
    } else if (hiddenAt) {
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = null;
      addTime(Math.min(away, AWAY_CAP));
      save();
    }
  });
  window.addEventListener('pagehide', save);

  // Work out which game a URL belongs to (ids match the older stats format)
  function gameInfo(url) {
    const m = url.match(/games\/([^\/?#]*)/);
    const slug = m && m[1] ? decodeURIComponent(m[1]) : 'clusterrush';
    const game = (window.GAMES || []).find(g => g.url === url || g.id === slug);
    return { id: slug, name: game ? game.name : slug };
  }

  function gameOpened(url) {
    const info = gameInfo(url);
    const g = data.games[info.id] || (data.games[info.id] = { name: info.name, opens: 0, time: 0 });
    g.name = info.name;
    g.opens++;
    data.totalOpens++;
    currentId = info.id;
    save();
    return info;
  }

  function gameClosed() {
    currentId = null;
    save();
  }

  // Most-played games, used for the "Activity" section on profiles
  function top(n) {
    return Object.keys(data.games)
      .map(id => ({ id: id, name: data.games[id].name, time: Math.floor(data.games[id].time) }))
      .filter(g => g.time >= 60)
      .sort((a, b) => b.time - a.time)
      .slice(0, n || 3);
  }

  window.Stats = { gameOpened: gameOpened, gameClosed: gameClosed, top: top, info: gameInfo };

  // ---------- UI ----------
  function fmt(s) {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + sec + 's';
    return sec + 's';
  }
  window.Stats.fmt = fmt;

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('statsBtn');
    const overlay = document.getElementById('statsOverlay');
    const closeBtn = document.getElementById('statsCloseBtn');
    const siteTimeEl = document.getElementById('statSiteTime');
    const opensEl = document.getElementById('statTotalOpens');
    const search = document.getElementById('statsSearch');
    const sort = document.getElementById('statsSort');
    const list = document.getElementById('statsGameList');
    let refresh = null;

    function render() {
      siteTimeEl.textContent = fmt(data.siteTime);
      opensEl.textContent = data.totalOpens;

      const q = search.value.toLowerCase().trim();
      const rows = Object.values(data.games).filter(g => g.name.toLowerCase().includes(q));

      if (sort.value === 'time') rows.sort((a, b) => b.time - a.time);
      else if (sort.value === 'opens') rows.sort((a, b) => b.opens - a.opens);
      else rows.sort((a, b) => a.name.localeCompare(b.name));

      list.innerHTML = '';
      if (rows.length === 0) {
        const p = document.createElement('p');
        p.className = 'stats-empty';
        p.textContent = Object.keys(data.games).length === 0
          ? 'No games played yet!'
          : 'No played games match your search.';
        list.appendChild(p);
        return;
      }

      rows.forEach(g => {
        const row = document.createElement('div');
        row.className = 'stats-game-row';
        const name = document.createElement('span');
        name.className = 'stats-game-name';
        name.textContent = g.name;
        const nums = document.createElement('span');
        nums.className = 'stats-game-nums';
        nums.textContent = fmt(g.time) + ' · opened ' + g.opens + 'x';
        row.appendChild(name);
        row.appendChild(nums);
        list.appendChild(row);
      });
    }

    function open() {
      overlay.classList.add('active');
      render();
      refresh = setInterval(render, 1000); // live-updating numbers
    }
    function close() {
      overlay.classList.remove('active');
      clearInterval(refresh);
    }

    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    search.addEventListener('input', render);
    sort.addEventListener('change', render);
  });
})();
