/* Buttons shown on top of a game (bottom-left) so chat, community and music
   can be used without closing the game. Only visible while a game is open. */
(function () {
  if (!window.Api || !Api.enabled || !window.UI) return;
  const { h } = window.UI;
  const badge = h('span', { class: 'acct-badge', hidden: true });
  const btn = (icon, title, fn, extra) => h('button', { class: 'dock-btn', title, onclick: fn }, h('span', { html: Icon(icon) }), extra || null);
  const dock = h('div', { id: 'gameDock', 'aria-label': 'Chat and music' },
    btn('comments', 'Friends & messages', () => (Social.isOpen() ? Social.close() : Social.open()), badge),
    btn('globe', 'Community chat', () => Social.openCommunity()),
    btn('music', 'Music', () => Music.open()));
  document.body.appendChild(dock);

  function counts() {
    const n = (Account.counts.requests || 0) + (Account.counts.unread || 0);
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : String(n);
  }
  document.addEventListener('boinga:counts', counts);
  document.addEventListener('boinga:user', e => { dock.classList.toggle('logged-out', !e.detail); });
  dock.classList.toggle('logged-out', !Account.user);
})();
