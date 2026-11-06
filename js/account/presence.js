/* Online status heartbeat. window.Presence
   active  = site tab is visible (in a game, or used in the last 5 minutes)
   away    = tab is in the background, or no mouse/keyboard for 5 minutes
   offline = tab closed (or "always appear offline" is on) */
(function () {
  const cfg = window.BOINGA_CONFIG || {};
  const INTERVAL = Math.max(20, Number(cfg.HEARTBEAT_SECONDS) || 45) * 1000;
  const IDLE_AFTER = 5 * 60 * 1000;

  let game = null;           // { id, name } while the game overlay is open
  let lastInput = Date.now();
  let lastState = null;
  let lastSent = 0;
  let lastActivity = '';
  let lastActivitySent = 0;
  let timer = null;
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
    if (!force && !extra && s === lastState && Date.now() - lastSent < INTERVAL - 2000) return;

    const body = Object.assign({ state: s, game: game }, extra || {});
    // Send top played games when they change (at most every 5 minutes)
    if (window.Stats && Date.now() - lastActivitySent > 5 * 60 * 1000) {
      const top = Stats.top(5);
      const sig = JSON.stringify(top);
      if (sig !== lastActivity) { body.activity = top; lastActivity = sig; }
      lastActivitySent = Date.now();
    }
    lastState = s;
    lastSent = Date.now();
    inflight = true;
    try {
      const r = await Api.post('/api/presence', body, { keepalive: !!(extra && extra.external) });
      Account.setCounts(r);
    } catch (e) { /* try again next tick */ }
    finally { inflight = false; }
  }

  function start() {
    stop();
    lastActivity = '';
    lastActivitySent = 0;
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

  // Closing the tab: drop offline right away instead of waiting for the timeout
  window.addEventListener('pagehide', () => {
    if (!Account.user || !Api.getToken()) return;
    try {
      fetch(Api.base + '/api/presence', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Api.getToken() },
        body: JSON.stringify({ state: 'offline' })
      });
    } catch (e) {}
  });
  window.addEventListener('pageshow', e => { if (e.persisted) beat(true); });

  window.Presence = { beat, noteExternal };
})();
