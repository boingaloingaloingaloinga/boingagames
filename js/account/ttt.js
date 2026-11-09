/* Tic-tac-toe cards inside DMs.
 * The server is the referee (turns, wins, the 10-second clock). This file just draws the
 * board, sends moves, and tells the server when it's your turn and the board is on screen
 * — that's when your 10 seconds start.
 *
 * window.TicTacToe = { start(peer) -> Promise<message>, card(msg, peer) -> element }
 */
(function () {
  if (!window.Api || !Api.enabled || !window.UI) return;
  const { h } = UI;

  async function start(peer) {
    const r = await Api.post('/api/games', { peerId: peer.id, kind: 'ttt' });
    return r.message;
  }

  // Is the card actually where the player can see it?
  const seenObs = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(e => { e.target.__visible = e.isIntersecting; if (e.isIntersecting && e.target.__onVisible) e.target.__onVisible(); });
  }, { threshold: 0.6 }) : null;

  function card(msg, peer) {
    const gameId = msg.meta && msg.meta.gameId;
    const cells = [];
    const board = h('div', { class: 'ttt-board' });
    for (let i = 0; i < 9; i++) {
      const c = h('button', { class: 'ttt-cell', type: 'button', 'aria-label': 'Square ' + (i + 1) });
      c.addEventListener('click', () => move(i));
      cells.push(c);
      board.appendChild(c);
    }
    const status = h('div', { class: 'ttt-status' }, 'Loading…');
    const clock = h('div', { class: 'ttt-clock', hidden: true }, h('span', { class: 'ttt-clock-fill' }));
    const forfeitBtn = h('button', { class: 'ttt-forfeit', type: 'button', hidden: true }, 'Give up');
    const againBtn = h('button', { class: 'acct-btn small ttt-again', type: 'button', hidden: true }, 'Rematch');
    const el = h('div', { class: 'ttt' },
      h('div', { class: 'ttt-head' }, h('span', { class: 'ttt-title' }, '❌⭕ Tic-Tac-Toe'), forfeitBtn),
      board, clock, status, againBtn);

    let game = null, gotAt = 0, timer = null, tick = null, busy = false, dead = false, seenSent = 0, waits = 0;

    const peerName = () => (peer && peer.username) || 'them';
    const visible = () => el.isConnected && document.visibilityState === 'visible' &&
      (seenObs ? el.__visible === true : el.offsetParent !== null);
    const remaining = () => game && game.clockRunning ? Math.max(0, game.remainingMs - (Date.now() - gotAt)) : null;

    function set(g) {
      game = g; gotAt = Date.now();
      render();
      schedule();
      maybeSeen();
    }

    function render() {
      if (!game) return;
      const g = game;
      el.classList.toggle('your-turn', g.yourTurn);
      el.classList.toggle('over', g.status !== 'active');
      g.board.forEach((v, i) => {
        const c = cells[i];
        c.textContent = v === '-' ? '' : v === 'X' ? '✕' : '◯';
        c.className = 'ttt-cell' + (v === 'X' ? ' x' : v === 'O' ? ' o' : '') + (g.line && g.line.includes(i) ? ' win' : '');
        c.disabled = !g.yourTurn || v !== '-' || busy;
      });
      forfeitBtn.hidden = g.status !== 'active';
      againBtn.hidden = g.status === 'active';
      const youWon = g.winner && g.winner === Account.user.id;
      const mark = g.you === 'X' ? '✕' : '◯';
      let text;
      switch (g.status) {
        case 'active':
          if (g.yourTurn) text = g.clockRunning ? 'Your turn (' + mark + ') — go!' : 'Your turn (' + mark + ')';
          else text = peerName() + "'s turn" + (g.clockRunning ? '…' : ' — waiting for them to look');
          break;
        case 'won': text = youWon ? '🎉 You win!' : '😵 ' + peerName() + ' wins!'; break;
        case 'tie': text = "🤝 It's a tie!"; break;
        case 'timeout': text = youWon ? '⏰ ' + peerName() + ' ran out of time — you win!' : '⏰ You ran out of time — ' + peerName() + ' wins!'; break;
        case 'forfeit': text = youWon ? '🏳️ ' + peerName() + ' gave up — you win!' : '🏳️ You gave up — ' + peerName() + ' wins.'; break;
        case 'expired': text = '💤 This game expired.'; break;
        default: text = '';
      }
      status.textContent = text;
      status.className = 'ttt-status' + (g.status === 'active' ? '' : youWon ? ' good' : g.winner ? ' bad' : '');
      drawClock();
    }

    function drawClock() {
      const left = remaining();
      clock.hidden = left === null;
      if (left === null) return;
      const pct = Math.max(0, Math.min(100, (left / game.turnMs) * 100));
      clock.firstChild.style.width = pct + '%';
      clock.classList.toggle('mine', game.yourTurn);
      clock.classList.toggle('low', left < 3500);
      clock.title = Math.ceil(left / 1000) + 's left';
      if (game.yourTurn && game.clockRunning) status.textContent = 'Your turn — ' + Math.ceil(left / 1000) + 's';
    }

    function schedule() {
      clearTimeout(timer);
      clearInterval(tick); tick = null;
      if (dead || !game || game.status !== 'active') return;
      if (game.clockRunning) {
        tick = setInterval(() => {
          drawClock();
          if (remaining() === 0) { clearInterval(tick); tick = null; setTimeout(refresh, 2300); }   // server allows a little grace
        }, 100);
      }
      // poll faster while the card is on screen
      timer = setTimeout(refresh, visible() ? 1300 : 5000);
    }

    async function refresh() {
      if (dead) return;
      if (!el.isConnected) {
        // not in the page (yet): wait a little for the first load, otherwise the chat was closed
        if (game || ++waits > 20) stop(); else timer = setTimeout(refresh, 300);
        return;
      }
      try { set((await Api.get('/api/games/' + gameId)).game); }
      catch (e) { if (e.status === 404) cleared(); else schedule(); }
    }

    // Start my 10 seconds once I can actually see the board on my turn
    async function maybeSeen() {
      if (!game || game.status !== 'active' || !game.yourTurn || game.clockRunning || !visible()) return;
      if (Date.now() - seenSent < 1500) return;
      seenSent = Date.now();
      try { set((await Api.post('/api/games/' + gameId + '/seen')).game); } catch (e) {}
    }

    async function move(i) {
      if (busy || !game || !game.yourTurn || game.board[i] !== '-') return;
      busy = true;
      cells[i].textContent = game.you === 'X' ? '✕' : '◯';
      cells.forEach(c => (c.disabled = true));
      try { set((await Api.post('/api/games/' + gameId + '/move', { cell: i })).game); }
      catch (e) { UI.toast(e.message, 'bad'); refresh(); }
      finally { busy = false; render(); }
    }

    forfeitBtn.addEventListener('click', async () => {
      if (!confirm('Give up this game? ' + peerName() + ' will win.')) return;
      try { set((await Api.post('/api/games/' + gameId + '/forfeit')).game); } catch (e) { UI.toast(e.message, 'bad'); }
    });
    againBtn.addEventListener('click', () => UI.busy(againBtn, async () => {
      try { const m = await start(peer); if (el.__onRematch) el.__onRematch(m); }
      catch (e) { UI.toast(e.message, 'bad'); }
    }));

    function cleared() {
      stop();
      el.innerHTML = '';
      el.classList.add('over');
      el.appendChild(h('div', { class: 'ttt-head' }, h('span', { class: 'ttt-title' }, '❌⭕ Tic-Tac-Toe')));
      el.appendChild(h('div', { class: 'ttt-status' }, 'This old game was cleared.'));
    }
    function stop() { dead = true; clearTimeout(timer); clearInterval(tick); if (seenObs) seenObs.unobserve(el); document.removeEventListener('visibilitychange', onVis); }
    function onVis() { if (document.visibilityState === 'visible') { maybeSeen(); refresh(); } }

    el.__onVisible = () => maybeSeen();
    el.__refresh = refresh;
    document.addEventListener('visibilitychange', onVis);
    if (!gameId) { cleared(); return el; }
    // observe once it's in the page
    requestAnimationFrame(() => { if (seenObs) seenObs.observe(el); refresh(); });
    return el;
  }

  window.TicTacToe = { start, card };
})();
