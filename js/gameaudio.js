/* Mutes the sound of the game that's open in the overlay (not your music).
 * Works for games hosted on this site (same origin). Games that live on another
 * site can't be touched by the browser's rules, so the button says so instead.
 *
 * How: as soon as the game's page exists we patch its Web Audio so everything that
 * plays to the speakers goes through one volume knob per AudioContext, and we mute
 * every <audio>/<video> element (including ones created later). Nested same-site
 * frames get the same treatment.
 *
 * window.GameAudio = { setMuted(bool), isMuted(), canMute() }
 */
(function () {
  const frame = document.getElementById('gameFrame');
  const overlay = document.getElementById('gameOverlay');
  if (!frame || !overlay) return;

  let muted = false;
  let userChose = false;       // the player pressed the button during this game
  let poll = null, pollUntil = 0;
  let reachable = null;        // null = unknown yet, true/false once the game page loaded

  /* ---------- patching ---------- */

  function access(w) { try { return w && w.document ? w : null; } catch (e) { return null; } }

  function patch(w) {
    if (!access(w)) return false;
    let st = w.__boingaAudio;
    if (!st) {
      st = w.__boingaAudio = { gains: new Map(), media: new Set() };
      try { patchWebAudio(w, st); } catch (e) {}
      try { patchMedia(w, st); } catch (e) {}
      // when this page goes away (the game navigates), catch the next one early
      try { w.addEventListener('pagehide', () => startPolling(4000)); } catch (e) {}
    }
    apply(w);
    try { for (let i = 0; i < w.frames.length; i++) patch(w.frames[i]); } catch (e) {}
    return true;
  }

  function patchWebAudio(w, st) {
    if (!w.AudioNode || !w.AudioDestinationNode) return;
    const proto = w.AudioNode.prototype;
    const connect = proto.connect, disconnect = proto.disconnect;
    const knob = ctx => {
      let g = st.gains.get(ctx);
      if (!g) {
        g = ctx.createGain();
        connect.call(g, ctx.destination);
        g.gain.value = muted ? 0 : 1;
        st.gains.set(ctx, g);
      }
      return g;
    };
    proto.connect = function (dest, ...rest) {
      if (dest instanceof w.AudioDestinationNode) return connect.call(this, knob(dest.context), ...rest) && dest;
      return connect.call(this, dest, ...rest);
    };
    proto.disconnect = function (dest, ...rest) {
      if (dest instanceof w.AudioDestinationNode) dest = st.gains.get(dest.context) || dest;
      return disconnect.call(this, dest, ...rest);
    };
  }

  function patchMedia(w, st) {
    if (!w.HTMLMediaElement) return;
    const proto = w.HTMLMediaElement.prototype;
    const play = proto.play;
    proto.play = function () {
      st.media.add(this);
      if (muted) this.muted = true;
      return play.apply(this, arguments);
    };
  }

  function apply(w) {
    const st = w.__boingaAudio;
    if (!st) return;
    st.gains.forEach((g, ctx) => {
      try { g.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime); } catch (e) { try { g.gain.value = muted ? 0 : 1; } catch (e2) {} }
    });
    try { w.document.querySelectorAll('audio, video').forEach(el => st.media.add(el)); } catch (e) {}
    st.media.forEach(el => {
      try {
        if (muted) { if (!el.muted) { el.muted = true; el.__boingaMuted = true; } }
        else if (el.__boingaMuted) { el.muted = false; el.__boingaMuted = false; }
      } catch (e) {}
    });
  }

  // Poll for the game's new document so we patch it before its scripts make sound.
  function startPolling(ms) {
    pollUntil = Date.now() + ms;
    if (poll) return;
    poll = setInterval(() => {
      const w = frame.contentWindow;
      const acc = access(w);
      if (acc && acc.location.href !== 'about:blank') patch(acc);
      if (Date.now() > pollUntil || !overlay.classList.contains('active')) { clearInterval(poll); poll = null; }
    }, 15);
  }

  frame.addEventListener('load', () => {
    if (!overlay.classList.contains('active')) return;
    const w = access(frame.contentWindow);
    reachable = !!w;
    if (w) patch(w);
    render();
  });

  // Re-apply now and then: catches media elements a game adds without calling play()
  setInterval(() => { if (muted && overlay.classList.contains('active')) { const w = access(frame.contentWindow); if (w) patch(w); } }, 1500);

  /* ---------- button ---------- */

  const btn = document.createElement('button');
  btn.id = 'gameSoundBtn';
  btn.type = 'button';
  overlay.appendChild(btn);
  btn.addEventListener('click', () => {
    if (reachable === false) {
      if (window.UI) UI.toast("This game runs on another site, so its sound can't be muted from here.");
      return;
    }
    userChose = true;
    setMuted(!muted);
  });

  function render() {
    const off = reachable === false;
    btn.classList.toggle('muted', muted && !off);
    btn.classList.toggle('unavailable', off);
    btn.innerHTML = window.Icon ? Icon(muted && !off ? 'volume-xmark' : 'volume-high') : (muted ? '🔇' : '🔊');
    btn.title = off ? "This game is on another site — its sound can't be muted here"
      : muted ? 'Game sound is off (your music keeps playing). Click to turn it on.'
      : 'Mute the game';
    btn.setAttribute('aria-label', btn.title);
  }

  function setMuted(on) {
    muted = !!on;
    const w = access(frame.contentWindow);
    if (w) patch(w);
    render();
  }

  const musicOn = () => !!(window.Music && Music.nowPlaying() && !Music.isMuted());

  document.addEventListener('boinga:gameopen', () => {
    userChose = false;
    reachable = null;
    muted = musicOn();
    startPolling(15000);
    render();
    if (muted && window.UI) UI.toast('🔇 Game sound is muted so you can hear your music. Use the speaker at the top right to turn it back on.');
  });
  document.addEventListener('boinga:gameclose', () => { muted = false; userChose = false; reachable = null; render(); });
  // Music started while playing: quiet the game, unless the player already picked a setting
  document.addEventListener('boinga:music', e => {
    if (!overlay.classList.contains('active') || userChose || muted || !e.detail) return;
    setMuted(true);
    if (reachable !== false && window.UI) UI.toast('🔇 Game sound muted while your music plays.');
  });

  render();
  window.GameAudio = { setMuted: on => { userChose = true; setMuted(on); }, isMuted: () => muted, canMute: () => reachable !== false };
})();
