/* Fullscreen game overlay. window.openGame(url) / window.closeGame()
   Fires 'boinga:gameopen' (detail: {id, name}) and 'boinga:gameclose' on document. */
(function () {
  const overlay = document.getElementById('gameOverlay');
  const frame = document.getElementById('gameFrame');
  const closeBtn = document.getElementById('gameCloseBtn');

  function openGame(url) {
    frame.src = url;
    overlay.classList.add('active');
    document.body.classList.add('in-game');
    document.body.style.overflow = 'hidden';
    frame.focus();
    const info = window.Stats ? Stats.gameOpened(url) : { id: url, name: url };
    document.dispatchEvent(new CustomEvent('boinga:gameopen', { detail: info }));
  }

  function closeGame() {
    overlay.classList.remove('active');
    document.body.classList.remove('in-game');
    frame.src = 'about:blank'; // unloads the game so audio stops
    document.body.style.overflow = '';
    if (window.Stats) Stats.gameClosed();
    document.dispatchEvent(new CustomEvent('boinga:gameclose'));
  }

  window.openGame = openGame;
  window.closeGame = closeGame;
  closeBtn.addEventListener('click', closeGame);
})();
