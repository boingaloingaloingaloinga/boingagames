/* Statistics: time on site + per-game playtime.
   Logged out: saved in this browser. Logged in: saved to your account, so they follow you to any computer.
   How syncing works: this computer only ever sends what was played since its last sync (a "delta",
   piggybacked on the online-status heartbeat), and the server adds it to your totals. Two computers
   playing at once just both add their time, nothing gets overwritten.
   Exposes window.Stats = { gameOpened(url), gameClosed(), top(n), info(url), fmt(s), takeDelta(), ack(ok), refresh() } */
(function () {
  const KEY = 'siteStats';                 // this computer's own stats (also used while logged out)
  const MERGED_KEY = 'siteStats.mergedInto'; // this computer's older stats were added to an account already
  const AWAY_CAP = 120; // seconds of off-tab time that still count

  const empty = () => ({ siteTime: 0, totalOpens: 0, games: {} });
  function read(key) {
    try {
      const d = JSON.parse(localStorage.getItem(key));
      if (d && d.games) return d;
    } catch (e) {}
    return empty();
  }
  function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  const local = read(KEY);
  // While logged in: base = totals from the server, pending = played here but not sent yet,
  // inflight = sent and waiting for the server to say OK.
  let acct = null;
  let fetching = false;
  let lastFetch = 0;

  function addInto(d, sec, gameId) {
    d.siteTime += sec;
    if (gameId) {
      const g = d.games[gameId] || (d.games[gameId] = { name: (local.games[gameId] || {}).name || gameId, opens: 0, time: 0 });
      g.time += sec;
    }
  }
  function sumInto(dst, src) {
    if (!src) return dst;
    dst.siteTime += src.siteTime || 0;
    dst.totalOpens += src.totalOpens || 0;
    for (const id in src.games || {}) {
      const s = src.games[id];
      const g = dst.games[id] || (dst.games[id] = { name: s.name || id, opens: 0, time: 0 });
      if (s.name) g.name = s.name;
      g.opens += s.opens || 0;
      g.time += s.time || 0;
    }
    return dst;
  }
  // What the stats window and your profile show
  function view() {
    if (!acct) return local;
    return sumInto(sumInto(sumInto(empty(), acct.base), acct.pending), acct.inflight);
  }

  function save() {
    write(KEY, local);
    if (acct) write('siteStats.pending.' + acct.uid, acct.pending);
  }

  let currentId = null;
  let hiddenAt = null;
  let ticks = 0;

  function addTime(sec) {
    addInto(local, sec, currentId && local.games[currentId] ? currentId : null);
    if (acct) addInto(acct.pending, sec, currentId);
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

  function opened(d, info) {
    const g = d.games[info.id] || (d.games[info.id] = { name: info.name, opens: 0, time: 0 });
    g.name = info.name;
    g.opens++;
    d.totalOpens++;
  }
  function gameOpened(url) {
    const info = gameInfo(url);
    opened(local, info);
    if (acct) opened(acct.pending, info);
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
    const d = view();
    return Object.keys(d.games)
      .map(id => ({ id: id, name: d.games[id].name, time: Math.floor(d.games[id].time) }))
      .filter(g => g.time >= 60)
      .sort((a, b) => b.time - a.time)
      .slice(0, n || 3);
  }

  /* ---------- syncing with your account ---------- */

  // Whole seconds only: fractions stay in pending for next time.
  function splitWhole(src) {
    const out = empty();
    out.siteTime = Math.floor(src.siteTime); src.siteTime -= out.siteTime;
    out.totalOpens = src.totalOpens; src.totalOpens = 0;
    for (const id in src.games) {
      const g = src.games[id];
      const t = Math.floor(g.time);
      if (t || g.opens) out.games[id] = { name: g.name, opens: g.opens, time: t };
      g.time -= t; g.opens = 0;
      if (g.time < 0.001) delete src.games[id];
    }
    const any = out.siteTime || out.totalOpens || Object.keys(out.games).length;
    return any ? out : null;
  }

  // Called by the heartbeat: hands over what to send (or null). Then ack(true/false) when it's done.
  function takeDelta() {
    if (!acct || acct.inflight || fetching) return null;
    const d = splitWhole(acct.pending);
    if (d) acct.inflight = d;
    save();
    return d;
  }
  function ack(ok) {
    if (!acct || !acct.inflight) return;
    sumInto(ok ? acct.base : acct.pending, acct.inflight);
    acct.inflight = null;
    if (ok) write('siteStats.acct.' + acct.uid, acct.base);
    save();
  }

  // Load the totals from the server (on login, and when you open the stats window)
  async function refresh() {
    if (!acct || fetching || acct.inflight || !window.Api) return;
    const a = acct;
    fetching = true;
    try {
      const r = await Api.get('/api/stats');
      if (acct === a) { a.base = r.stats; lastFetch = Date.now(); write('siteStats.acct.' + a.uid, a.base); }
    } catch (e) {}
    finally { fetching = false; }
  }

  async function login(user) {
    if (acct && acct.uid === user.id) return;
    acct = { uid: user.id, base: read('siteStats.acct.' + user.id), pending: read('siteStats.pending.' + user.id), inflight: null };
    // First account on this computer: add the stats this computer collected before (once only)
    let merged = null;
    try { merged = localStorage.getItem(MERGED_KEY); } catch (e) {}
    if (!merged && (local.siteTime >= 1 || Object.keys(local.games).length)) {
      try { localStorage.setItem(MERGED_KEY, String(user.id)); } catch (e) {}
      const copy = JSON.parse(JSON.stringify(local));
      const d = splitWhole(copy);
      if (d) {
        fetching = true;
        try { await Api.post('/api/stats', { delta: d }); }
        catch (e) { sumInto(acct.pending, d); }  // try again with the next heartbeat
        finally { fetching = false; }
      }
    } else if (!merged) {
      try { localStorage.setItem(MERGED_KEY, String(user.id)); } catch (e) {}
    }
    await refresh();
  }

  document.addEventListener('boinga:user', e => {
    if (e.detail) login(e.detail);
    else { save(); acct = null; }
  });

  window.Stats = { gameOpened: gameOpened, gameClosed: gameClosed, top: top, info: gameInfo,
    takeDelta: takeDelta, ack: ack, refresh: refresh, synced: () => !!acct };

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
    let ticker = null;
    const syncNote = document.getElementById('statsSyncNote');

    function render() {
      const data = view();
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
      if (acct && Date.now() - lastFetch > 60000) refresh().then(render);
      if (syncNote) syncNote.textContent = acct ? '* Synced to your account, so they follow you to other computers.' : '* Saved in this browser only. Log in to keep them on every computer.';
      render();
      ticker = setInterval(render, 1000); // live-updating numbers
    }
    function close() {
      overlay.classList.remove('active');
      clearInterval(ticker);
    }

    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    search.addEventListener('input', render);
    sort.addEventListener('change', render);
  });
})();
