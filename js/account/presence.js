/* Online status heartbeat. window.Presence
   active  = site tab is visible (in a game, or used in the last 5 minutes)
   away    = tab is in the background, or no mouse/keyboard for 5 minutes
   offline = tab closed (or "always appear offline" is on) */
(function () {
  const cfg = window.BOINGA_CONFIG || {};
  const BASE_INTERVAL = Math.max(20, Number(cfg.HEARTBEAT_SECONDS) || 45);
  // The server can slow heartbeats down (data saver)
  const interval = () => Math.max(BASE_INTERVAL, (window.Account && Account.saver && Account.saver.heartbeat) || 0) * 1000;
  const IDLE_AFTER = 5 * 60 * 1000;

  let game = null;           // { id, name } while the game overlay is open
  let lastInput = Date.now();
  let lastState = null;
  let lastSent = 0;
  let lastActivity = '';
  let lastActivitySent = 0;
  let lastFavorites = null;
  let lastMusic = null;
  let timer = null;
  let lastStatsSent = 0;
  // Stats ride along with a heartbeat about every 2 minutes (slower when the data saver is on)
  const statsInterval = () => Math.max(120, ((window.Account && Account.saver && Account.saver.heartbeat) || 0) * 2) * 1000;
  let inflight = false;

  function state() {
    if (document.visibilityState !== 'visible') return 'away';
    if (!game && Date.now() - lastInput > IDLE_AFTER) return 'away';
    return 'active';
  }

  async function beat(force, extra) {
    if (!Api.enabled || !window.Account || !Account.user) return;
    if (inflight && !extra) return;
    const s = state();
    const music = window.Music ? Music.nowPlaying() : null;
    const musicSig = music ? music.id : '';
    if (!force && !extra && s === lastState && musicSig === lastMusic && Date.now() - lastSent < interval() - 2000) return;

    const body = Object.assign({ state: s, game: game, music: music }, extra || {});
    lastMusic = musicSig;
    // Favorite games, only when they changed
    if (window.Library && Library.getFavorites) {
      const favs = JSON.stringify(Library.getFavorites());
      if (favs !== lastFavorites) { body.favorites = JSON.parse(favs); lastFavorites = favs; }
    }
    // Send top played games when they change (at most every 5 minutes)
    if (window.Stats && Date.now() - lastActivitySent > 5 * 60 * 1000) {
      const top = Stats.top(5);
      const sig = JSON.stringify(top);
      if (sig !== lastActivity) { body.activity = top; lastActivity = sig; }
      lastActivitySent = Date.now();
    }
    // Game stats played since the last sync, so they're the same on every computer
    let stats = null;
    if (window.Stats && Stats.takeDelta && Date.now() - lastStatsSent > statsInterval()) {
      stats = Stats.takeDelta();
      if (stats) { body.stats = stats; lastStatsSent = Date.now(); }
    }
    lastState = s;
    lastSent = Date.now();
    inflight = true;
    try {
      const r = await Api.post('/api/presence', body, { keepalive: !!(extra && extra.external) });
      if (stats) Stats.ack(true);
      Account.setCounts(r);
    } catch (e) { if (stats) Stats.ack(false); /* try again next tick */ }
    finally { inflight = false; }
  }

  function start() {
    stop();
    lastActivity = '';
    lastActivitySent = 0;
    lastFavorites = null;
    beat(true);
    timer = setInterval(() => beat(false), 5000); // checks often, only sends on change or every INTERVAL
  }
  function stop() { clearInterval(timer); timer = null; lastState = null; }

  // Going to an off-site game: let friends see where you went
  function noteExternal(g) {
    beat(true, { external: { id: g.id, name: g.name }, state: 'away' });
  }

  ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, () => {
      const wasIdle = Date.now() - lastInput > IDLE_AFTER;
      lastInput = Date.now();
      if (wasIdle) beat(true);
    }, { passive: true, capture: true }));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lastInput = Date.now();
    beat(true);
  });
  document.addEventListener('boinga:gameopen', e => { game = { id: e.detail.id, name: e.detail.name }; beat(true); });
  document.addEventListener('boinga:gameclose', () => { game = null; lastInput = Date.now(); beat(true); });
  document.addEventListener('boinga:user', e => { if (e.detail && !timer) start(); if (!e.detail) stop(); });
  document.addEventListener('boinga:favorites', () => beat(true));
  document.addEventListener('boinga:music', () => beat(false)); // sends when the song changes

  // Closing the tab: drop offline right away instead of waiting for the timeout
  window.addEventListener('pagehide', () => {
    if (!Account.user || !Api.getToken()) return;
    try {
      fetch(Api.base + '/api/presence', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Api.getToken() },
        body: JSON.stringify(Object.assign({ state: 'offline' }, (() => {
          // last bit of playtime from this visit
          const stats = window.Stats && Stats.takeDelta ? Stats.takeDelta() : null;
          if (stats) Stats.ack(true);
          return stats ? { stats } : {};
        })()))
      });
    } catch (e) {}
  });
  window.addEventListener('pageshow', e => { if (e.persisted) beat(true); });

  window.Presence = { beat, noteExternal };
})();
