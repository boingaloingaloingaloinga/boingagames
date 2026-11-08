/* =====================================================================
   BoingaGames Music
   - Search YouTube Music (songs, albums, artists) through the Worker
   - Plays through YouTube's embedded player, kept invisible; only covers are shown
   - Mini player bar: play/pause, skip, seek, shuffle, volume, queue
   - Playlists (saved to your account), shuffle on albums/artists/playlists, sharing
   window.Music = { open, openPlaylist(id), playOne(track), nowPlaying() }
   ===================================================================== */
(function () {
  if (!window.Api || !Api.enabled) return;
  const { h } = window.UI;

  /* ============================================================ ENGINE */

  let yt = null, ytReady = null;
  let queue = [];        // tracks
  let order = [];        // indexes into queue, in play order
  let pos = -1;          // position in order
  let playing = false;
  let shuffle = false;
  let errorsInRow = 0;
  let progressTimer = null;
  // Some browsers don't send YouTube's player events reliably, so playback is also
  // tracked by watching the clock: time moving = playing, reaching the end = next song.
  let userPaused = false, lastTime = -1, stalled = 0, endedFor = null;
  const store = (k, v) => { try { localStorage.setItem('music.' + k, JSON.stringify(v)); } catch (e) {} };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem('music.' + k)); return v === null ? d : v; } catch (e) { return d; } };
  let volume = load('volume', 80);
  shuffle = load('shuffle', false);
  let muted = false, autoMuted = false;
  let compactPref = load('compact', false);
  let expandedInGame = false; // user opened the full player while a game is open

  function loadYouTube() {
    if (ytReady) return ytReady;
    ytReady = new Promise(resolve => {
      const host = h('div', { id: 'ytBox', 'aria-hidden': 'true' }, h('div', { id: 'ytHost' }));
      document.body.appendChild(host);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prev) try { prev(); } catch (e) {}
        yt = new YT.Player('ytHost', {
          width: '200', height: '200',
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1 },
          events: {
            onReady: () => { yt.setVolume(volume); resolve(yt); },
            onStateChange: onState,
            onError: onError
          }
        });
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => UI.toast("Couldn't load the music player. Is YouTube blocked on this network?", 'bad');
      document.head.appendChild(s);
    });
    return ytReady;
  }

  const current = () => (pos >= 0 && pos < order.length ? queue[order[pos]] : null);

  function makeOrder(startIndex) {
    const idx = queue.map((_, i) => i);
    if (!shuffle) return { order: idx, pos: Math.max(0, startIndex) };
    const rest = idx.filter(i => i !== startIndex);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    return { order: startIndex >= 0 ? [startIndex].concat(rest) : rest, pos: 0 };
  }

  // Play a list of tracks starting at index (or a random one when shuffling with index -1)
  async function playList(tracks, index, opts) {
    tracks = (tracks || []).filter(t => t && t.id);
    if (!tracks.length) return UI.toast('Nothing to play here.');
    if (opts && typeof opts.shuffle === 'boolean') { shuffle = opts.shuffle; store('shuffle', shuffle); }
    queue = tracks.map(t => Object.assign({}, t));
    const start = index === undefined || index < 0 ? (shuffle ? -1 : 0) : index;
    const o = makeOrder(start);
    order = o.order; pos = o.pos;
    errorsInRow = 0;
    await playCurrent();
  }

  async function playCurrent() {
    const t = current();
    if (!t) return;
    showBar();
    renderBar();
    const p = await loadYouTube();
    p.loadVideoById(t.id);
    try { muted ? p.mute() : p.unMute(); } catch (e) {}
    playing = true;
    userPaused = false; lastTime = -1; stalled = 0; endedFor = null;
    startProgress();
    renderBar();
    renderQueueIfOpen();
    mediaSession(t);
    document.dispatchEvent(new CustomEvent('boinga:music', { detail: t }));
  }

  function onState(e) {
    const S = window.YT && YT.PlayerState;
    if (!S) return;
    if (e.data === S.PLAYING) { playing = true; errorsInRow = 0; startProgress(); }
    else if (e.data === S.PAUSED) { playing = false; }
    else if (e.data === S.ENDED) { const t = current(); if (t && endedFor !== t.id) { endedFor = t.id; playing = false; next(true); } }
    renderBar();
    document.dispatchEvent(new CustomEvent('boinga:music', { detail: current() }));
  }

  function onError(e) {
    const t = current();
    errorsInRow++;
    UI.toast((t ? '“' + t.title + '”' : 'That song') + " can't be played here. Skipping…", 'bad');
    if (errorsInRow >= 5) { errorsInRow = 0; playing = false; renderBar(); return; }
    setTimeout(() => next(true), 600);
  }

  function toggle() {
    if (!yt || !current()) return;
    if (playing) { userPaused = true; playing = false; yt.pauseVideo(); }
    else { userPaused = false; playing = true; yt.playVideo(); }
    renderBar();
    document.dispatchEvent(new CustomEvent('boinga:music', { detail: current() }));
  }
  function next(auto) {
    if (!order.length) return;
    if (pos < order.length - 1) { pos++; playCurrent(); }
    else if (auto) { playing = false; if (yt) yt.stopVideo(); renderBar(); document.dispatchEvent(new CustomEvent('boinga:music', { detail: null })); }
    else { pos = 0; playCurrent(); }
  }
  function prev() {
    if (!order.length) return;
    if (yt && yt.getCurrentTime && yt.getCurrentTime() > 3) { yt.seekTo(0, true); return; }
    pos = Math.max(0, pos - 1);
    playCurrent();
  }
  function setShuffle(on) {
    shuffle = on;
    store('shuffle', on);
    if (order.length) {
      const cur = order[pos];
      const o = makeOrder(cur);
      if (!on) { order = queue.map((_, i) => i); pos = cur; } else { order = o.order; pos = 0; }
    }
    renderBar();
    renderQueueIfOpen();
  }
  function seek(sec) { if (yt && yt.seekTo) { yt.seekTo(sec, true); lastTime = -1; updateProgress(); } }
  function setVolume(v) { volume = v; store('volume', v); if (yt && yt.setVolume) yt.setVolume(v); if (muted && v > 0) setMuted(false); }
  function setMuted(on) {
    muted = on;
    if (!on) autoMuted = false;
    if (yt) { try { on ? yt.mute() : yt.unMute(); } catch (e) {} }
    renderBar();
  }
  function stop() {
    if (yt && yt.stopVideo) yt.stopVideo();
    playing = false; queue = []; order = []; pos = -1;
    hideBar();
    document.dispatchEvent(new CustomEvent('boinga:music', { detail: null }));
  }
  function playNext(track) {
    if (!current()) return playList([track], 0);
    queue.push(Object.assign({}, track));
    order.splice(pos + 1, 0, queue.length - 1);
    UI.toast('Playing next: ' + track.title, 'good');
    renderQueueIfOpen();
  }

  function startProgress() {
    clearInterval(progressTimer);
    progressTimer = setInterval(updateProgress, 500);
  }

  function mediaSession(t) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork: t.cover ? [{ src: t.cover, sizes: '544x544' }] : [] });
      navigator.mediaSession.setActionHandler('play', () => yt && yt.playVideo());
      navigator.mediaSession.setActionHandler('pause', () => yt && yt.pauseVideo());
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    } catch (e) {}
  }

  /* ============================================================ BAR */

  let bar = null, els = {};
  function buildBar() {
    if (bar) return;
    els.cover = h('img', { class: 'mb-cover', alt: '' });
    els.title = h('div', { class: 'mb-title' });
    els.artist = h('div', { class: 'mb-artist' });
    els.play = h('button', { class: 'mb-play', title: 'Play / pause', onclick: toggle });
    els.prev = h('button', { class: 'mb-btn', title: 'Previous', onclick: prev }, '⏮');
    els.next = h('button', { class: 'mb-btn', title: 'Next', onclick: () => next() }, '⏭');
    els.shuffle = h('button', { class: 'mb-btn mb-shuffle', title: 'Shuffle', onclick: () => setShuffle(!shuffle) }, '🔀');
    els.seek = h('input', { type: 'range', class: 'mb-seek', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Seek' });
    els.time = h('span', { class: 'mb-time' }, '0:00');
    els.dur = h('span', { class: 'mb-time' }, '0:00');
    els.vol = h('input', { type: 'range', class: 'mb-vol', min: 0, max: 100, value: volume, 'aria-label': 'Volume' });
    els.mute = h('button', { class: 'mb-btn mb-mute', title: 'Mute', onclick: () => setMuted(!muted) });
    els.compact = h('button', { class: 'mb-btn mb-compact', title: 'Mini player', onclick: toggleCompact });
    let dragging = false;
    els.seek.addEventListener('input', () => { dragging = true; els.time.textContent = UI.fmtTime(Number(els.seek.value)); paintRange(els.seek); });
    els.seek.addEventListener('change', () => { dragging = false; seek(Number(els.seek.value)); });
    els.seekDragging = () => dragging;
    els.vol.addEventListener('input', () => { setVolume(Number(els.vol.value)); paintRange(els.vol); });
    paintRange(els.vol);

    bar = h('div', { id: 'musicBar', hidden: true },
      h('button', { class: 'mb-now', title: 'Show queue', onclick: () => openPanel('queue') }, els.cover, h('div', { class: 'mb-text' }, els.title, els.artist)),
      h('div', { class: 'mb-center' },
        h('div', { class: 'mb-controls' }, els.shuffle, els.prev, els.play, els.next,
          h('button', { class: 'mb-btn', title: 'Queue', onclick: () => openPanel('queue') }, '☰')),
        h('div', { class: 'mb-progress' }, els.time, els.seek, els.dur)),
      h('div', { class: 'mb-right' }, els.mute, els.vol, els.compact,
        h('button', { class: 'mb-btn mb-close', title: 'Stop and close player', onclick: stop }, '×')));
    document.body.appendChild(bar);
    els.drag = UI.makeDraggable(bar, bar, 'music', () => bar.classList.contains('compact'));
    applyMode();
  }
  function paintRange(r) {
    const pct = (Number(r.value) - Number(r.min)) / ((Number(r.max) - Number(r.min)) || 1) * 100;
    r.style.setProperty('--fill', pct + '%');
  }
  function showBar() { buildBar(); bar.hidden = false; document.body.classList.add('music-on'); applyMode(); }

  // Compact = small floating mini player (always used on top of games unless expanded)
  const inGame = () => document.body.classList.contains('in-game');
  function applyMode() {
    if (!bar) return;
    const compact = inGame() ? !expandedInGame : compactPref;
    const was = bar.classList.contains('compact');
    bar.classList.toggle('compact', compact);
    document.body.classList.toggle('music-compact', compact);
    if (compact && !was) els.drag.restore();
    if (!compact) els.drag.reset();
    els.compact.innerHTML = Icon(compact ? 'expand' : 'compress');
    els.compact.title = compact ? 'Full player' : 'Mini player';
  }
  function toggleCompact() {
    if (inGame()) expandedInGame = !expandedInGame;
    else { compactPref = !compactPref; store('compact', compactPref); }
    applyMode();
  }
  function hideBar() { if (bar) bar.hidden = true; document.body.classList.remove('music-on'); clearInterval(progressTimer); }

  function renderBar() {
    if (!bar) return;
    const t = current();
    if (!t) return;
    els.cover.src = t.cover || 'boinga.gif';
    els.title.textContent = t.title;
    els.artist.textContent = t.artist || '';
    els.play.textContent = playing ? '⏸' : '▶';
    els.mute.innerHTML = Icon(muted ? 'volume-xmark' : 'volume-high');
    els.mute.title = muted ? 'Unmute' : 'Mute';
    els.mute.classList.toggle('on', muted);
    els.shuffle.classList.toggle('on', shuffle);
    els.shuffle.title = shuffle ? 'Shuffle is on' : 'Shuffle is off';
    if (t.duration) { els.seek.max = t.duration; els.dur.textContent = UI.fmtTime(t.duration); }
  }

  function updateProgress() {
    if (!yt || !yt.getCurrentTime || !bar || bar.hidden) return;
    const exactD = yt.getDuration ? Number(yt.getDuration() || 0) : 0;
    const exactC = Number(yt.getCurrentTime() || 0);
    const d = Math.floor(exactD);
    const c = Math.floor(exactC);
    // Clock-based state (works even when YouTube's events don't arrive)
    const t = current();
    if (exactC > lastTime + 0.05 && lastTime >= 0) {
      if (!playing && !userPaused) { playing = true; errorsInRow = 0; renderBar(); document.dispatchEvent(new CustomEvent('boinga:music', { detail: t })); }
      stalled = 0;
    } else if (playing && lastTime >= 0 && Math.abs(exactC - lastTime) < 0.01) {
      stalled++;
    }
    lastTime = exactC;
    if (t && exactD > 1 && exactC >= exactD - 0.6 && endedFor !== t.id) { endedFor = t.id; playing = false; next(true); return; }
    if (d) { els.seek.max = d; els.dur.textContent = UI.fmtTime(d); const t = current(); if (t && !t.duration) t.duration = d; }
    if (!els.seekDragging()) { els.seek.value = c; els.time.textContent = UI.fmtTime(c); paintRange(els.seek); }
  }

  /* ============================================================ PANEL */

  let panel = null, view = null, viewStack = [];
  let searchInput = null, saverNote = null;
  let myPlaylists = null; // cached list

  function buildPanel() {
    if (panel) return;
    searchInput = h('input', { type: 'search', class: 'mp-search', placeholder: 'Search songs, albums, artists…', maxlength: 100, autocomplete: 'off' });
    saverNote = h('div', { class: 'mp-saver', hidden: true });
    view = h('div', { class: 'mp-view' });
    panel = h('aside', { id: 'musicPanel', class: 'music-panel', 'aria-label': 'Music' },
      h('div', { class: 'mp-head' },
        h('button', { class: 'social-back mp-back', title: 'Back', onclick: back }, '‹'),
        h('h2', null, '🎵 Music'),
        h('button', { class: 'social-x', title: 'Close', onclick: closePanel }, '×')),
      h('div', { class: 'mp-searchbar' }, h('i', { class: 'fa-solid fa-magnifying-glass' }), searchInput),
      saverNote,
      view);
    document.body.appendChild(panel);
    let t = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(t);
      const q = searchInput.value.trim();
      t = setTimeout(() => { if (q) go({ name: 'search', q }, true); else go({ name: 'home' }, true); }, 450);
    });
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { clearTimeout(t); const q = searchInput.value.trim(); if (q) go({ name: 'search', q }, true); }
      if (e.key === 'Escape') closePanel();
    });
    updateSaverNote();
  }

  function updateSaverNote() {
    if (!saverNote) return;
    const off = Account.saver && Account.saver.music === false;
    saverNote.hidden = !off;
    saverNote.textContent = '🌱 Music search is paused today to keep BoingaGames free. Your playlists still play!';
  }

  function openPanel(which) {
    buildPanel();
    panel.classList.add('open');
    if (which === 'queue') go({ name: 'queue' });
    else if (!viewStack.length) go({ name: 'home' }, true);
    setTimeout(() => { if (which !== 'queue') searchInput.focus(); }, 60);
  }
  function closePanel() { if (panel) panel.classList.remove('open'); }

  function go(v, replace) {
    if (replace) viewStack = [v]; else viewStack.push(v);
    render();
  }
  function back() {
    if (viewStack.length > 1) { viewStack.pop(); render(); }
    else { searchInput.value = ''; go({ name: 'home' }, true); }
  }
  function renderQueueIfOpen() { if (panel && panel.classList.contains('open') && viewStack.length && viewStack[viewStack.length - 1].name === 'queue') render(); }

  let renderSeq = 0;
  async function render() {
    const v = viewStack[viewStack.length - 1];
    panel.querySelector('.mp-back').style.visibility = v.name === 'home' ? 'hidden' : 'visible';
    const mySeq = ++renderSeq;
    view.innerHTML = '';
    view.scrollTop = 0;
    const box = h('div');
    view.appendChild(h('div', { class: 'acct-loading' }, 'Loading…'));
    try {
      await ({ home, search, seeAll, album, artist, playlist, queueView })[v.name === 'queue' ? 'queueView' : v.name](box, v);
      if (mySeq !== renderSeq) return;
      view.innerHTML = '';
      view.appendChild(box);
    } catch (e) {
      if (mySeq !== renderSeq) return;
      view.innerHTML = '';
      view.appendChild(h('p', { class: 'acct-error mp-error' }, e.message));
    }
  }

  /* ---------------------------------------------------------- pieces */

  const artistText = t => t.artist || (t.artists || []).map(a => a.name).join(', ');
  const slim = t => ({ id: t.id, title: t.title, artist: artistText(t), artists: t.artists || [], album: t.album || '', albumId: t.albumId || null, duration: t.duration || 0, cover: t.cover || '' });

  function trackRow(t, list, index, opts) {
    opts = opts || {};
    const isNow = current() && current().id === t.id;
    const row = h('div', { class: 'mp-track' + (isNow ? ' now' : '') },
      opts.number ? h('span', { class: 'mp-num' }, String(index + 1)) : null,
      h('img', { class: 'mp-cover', src: t.cover || 'boinga.gif', alt: '', loading: 'lazy' }),
      h('div', { class: 'mp-track-main' },
        h('div', { class: 'mp-track-title' }, isNow ? '🔊 ' : '', t.title),
        h('div', { class: 'mp-track-sub' }, [artistText(t), opts.showAlbum !== false && t.album ? t.album : null].filter(Boolean).join(' · '))),
      t.duration ? h('span', { class: 'mp-dur' }, UI.fmtTime(t.duration)) : null,
      h('button', { class: 'mp-more', title: 'More', onclick: e => { e.stopPropagation(); trackMenu(e.currentTarget, t, opts); } }, '⋯'));
    row.addEventListener('click', () => (opts.onClick ? opts.onClick() : playList(list.map(slim), index)));
    return row;
  }

  function trackMenu(anchor, t, opts) {
    document.querySelectorAll('.mp-menu').forEach(m => m.remove());
    const item = (label, fn) => h('button', { class: 'acct-menu-item', onclick: () => { menu.remove(); fn(); } }, label);
    const firstArtist = (t.artists || []).find(a => a.id);
    const menu = h('div', { class: 'acct-menu mp-menu' },
      item('▶ Play next', () => playNext(slim(t))),
      item('➕ Add to playlist', () => addToPlaylist(slim(t))),
      t.albumId ? item('💿 Go to album', () => go({ name: 'album', id: t.albumId })) : null,
      firstArtist ? item('🎤 Go to artist', () => go({ name: 'artist', id: firstArtist.id })) : null,
      opts.onRemove ? item('🗑 Remove from playlist', opts.onRemove) : null);
    anchor.parentNode.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function off(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', off); } }), 0);
  }

  function card(item, onclick, round) {
    const c = h('button', { class: 'mp-card', onclick },
      h('img', { class: 'mp-card-img' + (round ? ' round' : ''), src: item.cover || 'boinga.gif', alt: '', loading: 'lazy' }),
      h('div', { class: 'mp-card-title' }, item.title || item.name),
      h('div', { class: 'mp-card-sub' }, item.type === 'album'
        ? [item.kind, item.year].filter(Boolean).join(' · ') + ((item.artists || []).length ? ' · ' + item.artists.map(a => a.name).join(', ') : '')
        : (item.audience || (item.type === 'playlist' ? item.count + ' songs' : 'Artist'))));
    return c;
  }
  const albumCard = a => card(a, () => go({ name: 'album', id: a.id }));
  const artistCard = a => card(a, () => go({ name: 'artist', id: a.id }), true);

  function rowOf(title, items, more) {
    if (!items.length) return null;
    return h('section', { class: 'mp-section' },
      h('div', { class: 'mp-section-head' }, h('h3', null, title), more ? h('button', { class: 'lib-see-all', onclick: more }, 'See all ›') : null),
      h('div', { class: 'mp-cards' }, items));
  }

  function bigButtons(onPlay, onShuffle, extra) {
    return h('div', { class: 'mp-actions' },
      h('button', { class: 'acct-btn primary', onclick: onPlay }, '▶ Play'),
      h('button', { class: 'acct-btn', onclick: onShuffle }, '🔀 Shuffle'),
      extra || null);
  }

  function musicOff() {
    if (Account.saver && Account.saver.music === false) throw new Error('Music search is paused today to keep BoingaGames free. Your saved playlists still play!');
  }

  /* ------------------------------------------------------------ views */

  async function home(box) {
    box.appendChild(h('p', { class: 'mp-hint' }, 'Search for any song, album or artist. Music keeps playing while you play games!'));
    if (!Account.user) {
      box.appendChild(h('div', { class: 'mp-login' }, h('p', null, 'Log in to make playlists and share them with friends.'),
        h('button', { class: 'acct-btn primary', onclick: () => AuthUI.open('login') }, 'Log in / Sign up')));
      return;
    }
    const r = await Api.get('/api/playlists');
    myPlaylists = r.playlists;
    const head = h('div', { class: 'mp-section-head' }, h('h3', null, 'Your playlists'),
      h('button', { class: 'acct-btn small primary', onclick: () => newPlaylist().then(p => p && go({ name: 'playlist', id: p.id })) }, '＋ New'));
    const sec = h('section', { class: 'mp-section' }, head);
    if (!r.playlists.length) sec.appendChild(h('p', { class: 'mp-hint' }, 'No playlists yet. Make one, or tap ⋯ on any song to add it.'));
    else sec.appendChild(h('div', { class: 'mp-cards' }, r.playlists.map(p => card(Object.assign({ type: 'playlist', title: p.name }, p), () => go({ name: 'playlist', id: p.id })))));
    box.appendChild(sec);
  }

  async function search(box, v) {
    musicOff();
    const r = await Api.get('/api/music/search?q=' + encodeURIComponent(v.q));
    if (!r.top && !r.songs.length && !r.albums.length && !r.artists.length) {
      box.appendChild(h('p', { class: 'mp-hint' }, 'Nothing found for “' + v.q + '”.'));
      return;
    }
    if (r.top) {
      const t = r.top;
      const topEl = h('button', { class: 'mp-top', onclick: () => {
        if (t.type === 'artist') go({ name: 'artist', id: t.id });
        else if (t.type === 'album') go({ name: 'album', id: t.id });
        else playList([slim(t)], 0);
      } },
        h('img', { class: 'mp-top-img' + (t.type === 'artist' ? ' round' : ''), src: t.cover || 'boinga.gif', alt: '' }),
        h('div', null,
          h('small', null, 'Top result · ' + (t.type === 'artist' ? 'Artist' : t.type === 'album' ? (t.kind || 'Album') : 'Song')),
          h('strong', null, t.title || t.name),
          h('span', null, t.type === 'artist' ? (t.audience || '') : artistText(t))));
      box.appendChild(topEl);
    }
    if (r.songs.length) {
      const songs = r.songs.slice(0, 6);
      box.appendChild(h('section', { class: 'mp-section' },
        h('div', { class: 'mp-section-head' }, h('h3', null, 'Songs'), h('button', { class: 'lib-see-all', onclick: () => go({ name: 'seeAll', q: v.q, type: 'songs' }) }, 'See all ›')),
        songs.map((t, i) => trackRow(t, songs, i))));
    }
    const al = rowOf('Albums', r.albums.slice(0, 10).map(albumCard), () => go({ name: 'seeAll', q: v.q, type: 'albums' }));
    if (al) box.appendChild(al);
    const ar = rowOf('Artists', r.artists.slice(0, 10).map(artistCard), () => go({ name: 'seeAll', q: v.q, type: 'artists' }));
    if (ar) box.appendChild(ar);
  }

  async function seeAll(box, v) {
    musicOff();
    const r = await Api.get('/api/music/search?type=' + v.type + '&q=' + encodeURIComponent(v.q));
    box.appendChild(h('h3', { class: 'mp-title' }, { songs: 'Songs', albums: 'Albums', artists: 'Artists' }[v.type] + ' for “' + v.q + '”'));
    if (v.type === 'songs') {
      box.appendChild(bigButtons(() => playList(r.songs.map(slim), 0, { shuffle: false }), () => playList(r.songs.map(slim), -1, { shuffle: true })));
      r.songs.forEach((t, i) => box.appendChild(trackRow(t, r.songs, i)));
    } else {
      const items = (v.type === 'albums' ? r.albums.map(albumCard) : r.artists.map(artistCard));
      box.appendChild(h('div', { class: 'mp-grid' }, items));
    }
    if (!(r[v.type] || []).length) box.appendChild(h('p', { class: 'mp-hint' }, 'Nothing found.'));
  }

  async function album(box, v) {
    musicOff();
    const a = await Api.get('/api/music/album/' + encodeURIComponent(v.id));
    const tracks = a.tracks;
    box.appendChild(h('div', { class: 'mp-hero' },
      h('img', { class: 'mp-hero-img', src: a.cover || 'boinga.gif', alt: '' }),
      h('div', { class: 'mp-hero-text' },
        h('small', null, [a.kind, a.year].filter(Boolean).join(' · ')),
        h('h3', null, a.title),
        h('div', { class: 'mp-artists' }, a.artists.map((ar, i) => [i ? ', ' : '', ar.id ? h('button', { class: 'mp-link', onclick: () => go({ name: 'artist', id: ar.id }) }, ar.name) : ar.name]).flat()),
        h('small', null, a.info || ''))));
    box.appendChild(bigButtons(
      () => playList(tracks.map(slim), 0, { shuffle: false }),
      () => playList(tracks.map(slim), -1, { shuffle: true }),
      Account.user ? h('button', { class: 'acct-btn', onclick: async () => {
        try {
          const r = await Api.post('/api/playlists', { name: a.title, tracks: tracks.map(slim) });
          UI.toast('Saved “' + a.title + '” to your playlists!', 'good');
          myPlaylists = null;
          return r;
        } catch (e) { UI.toast(e.message, 'bad'); }
      } }, '💾 Save') : null));
    tracks.forEach((t, i) => box.appendChild(trackRow(t, tracks, i, { number: true, showAlbum: false })));
    const more = rowOf('More by this artist', (a.more || []).map(albumCard));
    if (more) box.appendChild(more);
  }

  async function artist(box, v) {
    musicOff();
    const a = await Api.get('/api/music/artist/' + encodeURIComponent(v.id));
    const hero = h('div', { class: 'mp-artist-hero' },
      a.banner ? h('img', { class: 'mp-artist-banner', src: a.banner, alt: '' }) : null,
      h('div', { class: 'mp-artist-name' }, h('h3', null, a.name), a.audience ? h('small', null, a.audience + ' subscribers') : null));
    box.appendChild(hero);
    const allSongs = async () => {
      if (!a.allSongsId) return a.topSongs.map(slim);
      try { return (await Api.get('/api/music/list/' + encodeURIComponent(a.allSongsId))).tracks.map(slim); }
      catch (e) { return a.topSongs.map(slim); }
    };
    box.appendChild(bigButtons(
      async () => playList(await allSongs(), 0, { shuffle: false }),
      async () => playList(await allSongs(), -1, { shuffle: true })));
    if (a.topSongs.length) {
      box.appendChild(h('section', { class: 'mp-section' }, h('div', { class: 'mp-section-head' }, h('h3', null, 'Top songs')),
        a.topSongs.map((t, i) => trackRow(t, a.topSongs, i))));
    }
    [['Albums', a.albums], ['Singles & EPs', a.singles]].forEach(([title, list]) => {
      const r = rowOf(title, list.map(albumCard));
      if (r) box.appendChild(r);
    });
    const rel = rowOf('Fans also like', a.related.map(artistCard));
    if (rel) box.appendChild(rel);
  }

  async function playlist(box, v) {
    if (!Account.user) { box.appendChild(h('p', { class: 'mp-hint' }, 'Log in to open playlists.')); return; }
    const r = await Api.get('/api/playlists/' + v.id);
    const p = r.playlist, tracks = r.tracks;
    const mine = p.ownerId === Account.user.id;
    box.appendChild(h('div', { class: 'mp-hero' },
      h('img', { class: 'mp-hero-img', src: p.cover || 'boinga.gif', alt: '' }),
      h('div', { class: 'mp-hero-text' },
        h('small', null, 'Playlist' + (mine ? '' : ' · by ' + p.owner)),
        h('h3', null, p.name),
        h('small', null, p.count + ' songs'))));
    const extra = mine
      ? h('span', { class: 'mp-actions-extra' },
          h('button', { class: 'acct-btn', title: 'Share with a friend or group', onclick: () => Social.shareTo({ playlistId: p.id }, '“' + p.name + '”') }, '📤 Share'),
          h('button', { class: 'acct-btn icon', title: 'More', onclick: e => playlistMenu(e.currentTarget, p) }, '⋯'))
      : h('button', { class: 'acct-btn', onclick: async () => {
          try { await Api.post('/api/playlists/' + p.id + '/copy'); myPlaylists = null; UI.toast('Saved a copy to your playlists!', 'good'); }
          catch (e) { UI.toast(e.message, 'bad'); }
        } }, '💾 Save copy');
    box.appendChild(bigButtons(() => playList(tracks, 0, { shuffle: false }), () => playList(tracks, -1, { shuffle: true }), extra));
    if (!tracks.length) box.appendChild(h('p', { class: 'mp-hint' }, mine ? 'Empty! Search for songs and use ⋯ → Add to playlist.' : 'This playlist is empty.'));
    tracks.forEach((t, i) => box.appendChild(trackRow(t, tracks, i, {
      number: true,
      onRemove: mine ? async () => {
        try { await Api.del('/api/playlists/' + p.id + '/tracks/' + t.pos); render(); } catch (e) { UI.toast(e.message, 'bad'); }
      } : null
    })));
  }

  function playlistMenu(anchor, p) {
    document.querySelectorAll('.mp-menu').forEach(m => m.remove());
    const item = (label, fn) => h('button', { class: 'acct-menu-item', onclick: () => { menu.remove(); fn(); } }, label);
    const menu = h('div', { class: 'acct-menu mp-menu' },
      item('✏️ Rename', async () => {
        const name = prompt('New name for the playlist:', p.name);
        if (!name) return;
        try { await Api.patch('/api/playlists/' + p.id, { name }); render(); } catch (e) { UI.toast(e.message, 'bad'); }
      }),
      item('🗑 Delete playlist', async () => {
        if (!confirm('Delete “' + p.name + '”? This can\'t be undone.')) return;
        try { await Api.del('/api/playlists/' + p.id); myPlaylists = null; back(); } catch (e) { UI.toast(e.message, 'bad'); }
      }));
    anchor.parentNode.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function off(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', off); } }), 0);
  }

  async function queueView(box) {
    const t = current();
    if (!t) { box.appendChild(h('p', { class: 'mp-hint' }, 'Nothing playing yet. Search for something!')); return; }
    box.appendChild(h('div', { class: 'mp-hero' },
      h('img', { class: 'mp-hero-img', src: t.cover || 'boinga.gif', alt: '' }),
      h('div', { class: 'mp-hero-text' }, h('small', null, playing ? 'Now playing' : 'Paused'), h('h3', null, t.title), h('span', null, artistText(t)), t.album ? h('small', null, t.album) : null)));
    const upNext = order.slice(pos + 1).map(i => queue[i]);
    box.appendChild(h('div', { class: 'mp-section-head' }, h('h3', null, 'Up next' + (shuffle ? ' (shuffled)' : '')),
      h('button', { class: 'acct-btn small' + (shuffle ? ' primary' : ''), onclick: () => setShuffle(!shuffle) }, '🔀 Shuffle ' + (shuffle ? 'on' : 'off'))));
    if (!upNext.length) box.appendChild(h('p', { class: 'mp-hint' }, 'That\'s the last song.'));
    upNext.slice(0, 100).forEach((tr, k) => {
      box.appendChild(trackRow(tr, [tr], 0, { onClick: () => { pos = pos + 1 + k; playCurrent(); } }));
    });
  }

  /* ------------------------------------------------------ playlists */

  async function newPlaylist(tracks) {
    if (!Account.user) { AuthUI.open('login'); return null; }
    const name = prompt('Name your playlist:', 'My playlist');
    if (!name) return null;
    try {
      const r = await Api.post('/api/playlists', { name, tracks: tracks || [] });
      myPlaylists = null;
      UI.toast('Playlist “' + r.playlist.name + '” created!', 'good');
      return r.playlist;
    } catch (e) { UI.toast(e.message, 'bad'); return null; }
  }

  async function addToPlaylist(track) {
    if (!Account.user) return AuthUI.open('login');
    if (!myPlaylists) { try { myPlaylists = (await Api.get('/api/playlists')).playlists; } catch (e) { return UI.toast(e.message, 'bad'); } }
    const list = h('div', { class: 'pick-list' });
    const m = UI.modal({ title: 'Add to playlist', body: list });
    list.appendChild(h('button', { class: 'acct-btn primary wide', onclick: async () => {
      m.close();
      const p = await newPlaylist([track]);
      if (p) render();
    } }, '＋ New playlist with this song'));
    myPlaylists.forEach(p => {
      list.appendChild(h('button', { class: 'pick-row pl-pick', onclick: async () => {
        try {
          const r = await Api.post('/api/playlists/' + p.id + '/tracks', { track });
          Object.assign(p, r.playlist);
          m.close();
          UI.toast('Added to “' + p.name + '”', 'good');
        } catch (e) { UI.toast(e.message, 'bad'); }
      } }, h('img', { src: p.cover || 'boinga.gif', alt: '' }), h('span', null, p.name), h('small', null, p.count + ' songs')));
    });
  }

  /* ------------------------------------------------------------- API */

  function openPlaylist(id) {
    openPanel();
    go({ name: 'playlist', id });
  }
  function playOne(track) { playList([track], 0, { shuffle: false }); }
  function nowPlaying() {
    const t = current();
    if (!t || !playing) return null;
    return { id: t.id, title: t.title, artist: t.artist || '', cover: t.cover || '' };
  }

  // Top-right button
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('musicBtn');
    if (btn) { btn.hidden = false; btn.addEventListener('click', () => (panel && panel.classList.contains('open') ? closePanel() : openPanel())); }
  });
  document.addEventListener('boinga:saver', updateSaverNote);
  // Games: mute the music (it keeps its place) and switch to the mini player on top of the game
  document.addEventListener('boinga:gameopen', () => {
    expandedInGame = false;
    if (current() && !muted) {
      setMuted(true);
      autoMuted = true;
      UI.toast('🔇 Music muted while you play. Tap the speaker on the mini player to unmute.');
    }
    if (panel && panel.classList.contains('open')) closePanel();
    applyMode();
  });
  document.addEventListener('boinga:gameclose', () => {
    if (autoMuted) setMuted(false);
    autoMuted = false;
    expandedInGame = false;
    applyMode();
  });
  document.addEventListener('boinga:user', () => { myPlaylists = null; if (panel && panel.classList.contains('open')) render(); });

  window.Music = { open: openPanel, openPlaylist, playOne, nowPlaying, playList, hasTrack: () => !!current(), isMuted: () => muted };
})();
