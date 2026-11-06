/* Friends drawer + direct messages. window.Social */
(function () {
  const { h } = window.UI;
  const cfg = window.BOINGA_CONFIG || {};

  let drawer = null;       // root element
  let content = null;      // area that swaps between list + chat
  let tab = 'friends';
  let data = { friends: [], incoming: [], outgoing: [] };
  let listTimer = null;
  let chat = null;         // { user, lastId, firstId, timer, el... }

  /* ------------------------------------------------------------ drawer */

  function ensureDrawer() {
    if (drawer) return;
    drawer = h('aside', { id: 'socialDrawer', class: 'social', 'aria-label': 'Friends and messages' });
    content = h('div', { class: 'social-content' });
    drawer.appendChild(content);
    document.body.appendChild(drawer);
    drawer.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('.acct-overlay')) close(); });
  }

  function open(which) {
    if (!Account.user) return AuthUI.open('login');
    ensureDrawer();
    if (which) tab = which;
    drawer.classList.add('open');
    document.body.classList.add('social-open');
    if (!chat) renderList();
    refreshList();
    clearInterval(listTimer);
    listTimer = setInterval(() => { if (document.visibilityState === 'visible' && !chat) refreshList(); }, 20000);
  }

  function close() {
    if (!drawer) return;
    closeChat(true);
    drawer.classList.remove('open');
    document.body.classList.remove('social-open');
    clearInterval(listTimer);
  }

  async function refreshList() {
    try {
      data = await Api.get('/api/friends');
      if (!chat && drawer && drawer.classList.contains('open')) renderList();
    } catch (e) { /* shown on next render */ }
  }

  function header(title, left) {
    return h('div', { class: 'social-head' },
      left || null,
      h('h2', null, title),
      h('button', { class: 'social-x', title: 'Close', onclick: close }, '×'));
  }

  function renderList() {
    content.innerHTML = '';
    content.appendChild(header('Friends'));
    const reqCount = data.incoming.length;
    const tabs = h('div', { class: 'seg social-tabs' },
      h('button', { class: tab === 'friends' ? 'active' : '', onclick: () => { tab = 'friends'; renderList(); } }, 'Friends' + (data.friends.length ? ' (' + data.friends.length + ')' : '')),
      h('button', { class: tab === 'requests' ? 'active' : '', onclick: () => { tab = 'requests'; renderList(); } },
        'Requests', reqCount ? h('span', { class: 'acct-badge inline' }, String(reqCount)) : null),
      h('button', { class: tab === 'add' ? 'active' : '', onclick: () => { tab = 'add'; renderList(); } }, 'Add'));
    content.appendChild(tabs);
    const body = h('div', { class: 'social-body' });
    content.appendChild(body);
    if (tab === 'friends') friendsTab(body);
    else if (tab === 'requests') requestsTab(body);
    else addTab(body);
  }

  const ORDER = { active: 0, away: 1, offline: 2 };

  function personRow(u, sub, right, onclick) {
    const row = h('div', { class: 'social-row' + (onclick ? ' clickable' : '') },
      UI.avatarEl(u, 40, true),
      h('div', { class: 'social-row-main' }, UI.nameEl(u), h('div', { class: 'social-sub ' + (u.status || '') }, sub)),
      right || null);
    if (onclick) row.addEventListener('click', e => { if (!e.target.closest('button')) onclick(); });
    return row;
  }

  function friendsTab(body) {
    if (!data.friends.length) {
      body.appendChild(h('div', { class: 'social-empty' },
        h('p', null, 'No friends yet.'),
        h('button', { class: 'acct-btn primary', onclick: () => { tab = 'add'; renderList(); } }, 'Find people')));
      return;
    }
    const sorted = [...data.friends].sort((a, b) =>
      (b.unread > 0) - (a.unread > 0) || ORDER[a.status] - ORDER[b.status] || a.username.localeCompare(b.username));
    let lastGroup = null;
    sorted.forEach(f => {
      const group = f.status === 'offline' ? 'Offline' : 'Online';
      if (group !== lastGroup) {
        const n = sorted.filter(x => (x.status === 'offline') === (group === 'Offline')).length;
        body.appendChild(h('div', { class: 'social-group' }, group + ' — ' + n));
        lastGroup = group;
      }
      const right = h('div', { class: 'social-right' },
        f.unread ? h('span', { class: 'acct-badge inline' }, String(f.unread)) : null,
        h('button', { class: 'social-mini', title: 'View profile', onclick: () => Profile.view(f.username), html: '<i class="fa-solid fa-id-badge"></i>' }));
      body.appendChild(personRow(f, UI.statusLine(f), right, () => openChat(f)));
    });
  }

  function requestsTab(body) {
    if (!data.incoming.length && !data.outgoing.length) {
      body.appendChild(h('p', { class: 'social-empty' }, 'No friend requests right now.'));
      return;
    }
    if (data.incoming.length) body.appendChild(h('div', { class: 'social-group' }, 'Wants to be your friend'));
    data.incoming.forEach(u => {
      const yes = h('button', { class: 'acct-btn small primary' }, 'Accept');
      const no = h('button', { class: 'acct-btn small' }, 'Decline');
      yes.addEventListener('click', () => UI.busy(yes, () => respond(u, true)));
      no.addEventListener('click', () => UI.busy(no, () => respond(u, false)));
      body.appendChild(personRow(u, UI.statusLine(u), h('div', { class: 'social-right' }, yes, no), () => Profile.view(u.username)));
    });
    if (data.outgoing.length) body.appendChild(h('div', { class: 'social-group' }, 'Sent'));
    data.outgoing.forEach(u => {
      const cancel = h('button', { class: 'acct-btn small' }, 'Cancel');
      cancel.addEventListener('click', () => UI.busy(cancel, async () => {
        try { await Api.del('/api/friends/' + u.id); await refreshList(); } catch (e) { UI.toast(e.message, 'bad'); }
      }));
      body.appendChild(personRow(u, 'Pending', h('div', { class: 'social-right' }, cancel), () => Profile.view(u.username)));
    });
  }

  async function respond(u, accept) {
    try {
      await Api.post('/api/friends/respond', { userId: u.id, accept });
      if (accept) UI.toast('You and ' + u.username + ' are now friends!', 'good');
      await refreshList();
      if (window.Presence) Presence.beat(true);
    } catch (e) { UI.toast(e.message, 'bad'); }
  }

  function addTab(body) {
    const input = h('input', { type: 'search', class: 'social-search', placeholder: 'Search usernames…', maxlength: 20, spellcheck: 'false' });
    const results = h('div', { class: 'social-results' }, h('p', { class: 'acct-hint center' }, 'Type a username to find someone.'));
    body.appendChild(input);
    body.appendChild(results);
    setTimeout(() => input.focus(), 30);
    let timer = null, seq = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { results.innerHTML = ''; results.appendChild(h('p', { class: 'acct-hint center' }, 'Type a username to find someone.')); return; }
      timer = setTimeout(async () => {
        const mySeq = ++seq;
        try {
          const r = await Api.get('/api/users/search?q=' + encodeURIComponent(q));
          if (mySeq !== seq) return;
          results.innerHTML = '';
          if (!r.users.length) { results.appendChild(h('p', { class: 'acct-hint center' }, 'Nobody found with that name.')); return; }
          const friendIds = new Set(data.friends.map(f => f.id));
          const outIds = new Set(data.outgoing.map(f => f.id));
          const inIds = new Set(data.incoming.map(f => f.id));
          r.users.forEach(u => {
            let right;
            if (friendIds.has(u.id)) right = h('span', { class: 'acct-hint' }, 'Friends ✓');
            else if (outIds.has(u.id)) right = h('span', { class: 'acct-hint' }, 'Sent');
            else {
              const add = h('button', { class: 'acct-btn small primary' }, inIds.has(u.id) ? 'Accept' : 'Add');
              add.addEventListener('click', () => UI.busy(add, async () => {
                try {
                  const res = await Api.post('/api/friends/request', { username: u.username });
                  add.replaceWith(h('span', { class: 'acct-hint' }, res.relationship === 'friends' ? 'Friends ✓' : 'Sent'));
                  refreshList();
                } catch (e) { UI.toast(e.message, 'bad'); }
              }));
              right = add;
            }
            results.appendChild(personRow(u, UI.statusLine(u), h('div', { class: 'social-right' }, right), () => Profile.view(u.username)));
          });
        } catch (e) { results.innerHTML = ''; results.appendChild(h('p', { class: 'acct-error' }, e.message)); }
      }, 300);
    });
  }

  /* -------------------------------------------------------------- chat */

  function openChat(user) {
    if (!Account.user) return;
    open();
    closeChat(true);
    content.innerHTML = '';
    const back = h('button', { class: 'social-back', title: 'Back', onclick: () => { closeChat(); } }, '‹');
    const who = h('button', { class: 'chat-who', onclick: () => Profile.view(user.username) },
      UI.avatarEl(user, 34, true),
      h('div', null, UI.nameEl(user), h('div', { class: 'social-sub ' + user.status }, UI.statusLine(user))));
    const head = h('div', { class: 'social-head chat-head' }, back, who,
      h('button', { class: 'social-x', title: 'Close', onclick: close }, '×'));

    const list = h('div', { class: 'chat-list' }, h('div', { class: 'acct-loading' }, 'Loading…'));
    const older = h('button', { class: 'chat-older', hidden: true }, 'Load older messages');

    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
    const attachBtn = h('button', { class: 'chat-attach', title: 'Attach an image or GIF', onclick: () => fileInput.click(), html: '<i class="fa-solid fa-image"></i>' });
    const text = h('textarea', { class: 'chat-text', rows: 1, maxlength: 1000, placeholder: 'Message ' + user.username + '…' });
    const sendBtn = h('button', { class: 'chat-send', title: 'Send', html: '<i class="fa-solid fa-paper-plane"></i>' });
    const pending = h('div', { class: 'chat-pending', hidden: true });
    const err = UI.errorBox();
    const composer = h('div', { class: 'chat-compose' }, pending, err,
      h('div', { class: 'chat-compose-row' }, attachBtn, text, sendBtn), fileInput,
      h('div', { class: 'chat-note' }, 'Images & GIFs are deleted from the server after a while to save space.'));

    content.appendChild(head);
    content.appendChild(h('div', { class: 'chat-scroll' }, older, list));
    content.appendChild(composer);

    chat = { user, lastId: 0, firstId: 0, list, text, attachment: null, timer: null, ids: new Set() };
    const scroller = list.parentNode;

    text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 120) + 'px'; });
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    sendBtn.addEventListener('click', send);

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      err.show('');
      try { await UI.checkImage(file, UI.IMAGE_RULES.chat); }
      catch (e) { return err.show(e.message); }
      const url = URL.createObjectURL(file);
      chat.attachment = { file, url, key: null };
      pending.innerHTML = '';
      pending.appendChild(h('img', { src: url, alt: '' }));
      pending.appendChild(h('button', { class: 'chat-pending-x', title: 'Remove', onclick: clearAttachment }, '×'));
      pending.hidden = false;
      text.focus();
    });
    function clearAttachment() {
      if (chat && chat.attachment) URL.revokeObjectURL(chat.attachment.url);
      if (chat) chat.attachment = null;
      pending.hidden = true;
      pending.innerHTML = '';
    }

    let sending = false;
    async function send() {
      if (sending || !chat) return;
      const body = text.value.trim();
      if (!body && !chat.attachment) return;
      sending = true;
      sendBtn.disabled = true;
      err.show('');
      try {
        let key = null;
        if (chat.attachment) {
          if (!chat.attachment.key) chat.attachment.key = (await Api.post('/api/upload/chat', chat.attachment.file)).key;
          key = chat.attachment.key;
        }
        const r = await Api.post('/api/messages/' + user.id, { body, attachment: key });
        text.value = '';
        text.style.height = 'auto';
        clearAttachment();
        addMessages([r.message], true);
      } catch (e) {
        err.show(e.message);
      } finally {
        sending = false;
        sendBtn.disabled = false;
        text.focus();
      }
    }

    older.addEventListener('click', () => UI.busy(older, async () => {
      const r = await Api.get('/api/messages/' + user.id + '?before=' + chat.firstId);
      const prevH = scroller.scrollHeight;
      prependMessages(r.messages);
      scroller.scrollTop = scroller.scrollHeight - prevH;
      older.hidden = r.messages.length < 50;
    }));

    (async function initial() {
      try {
        const r = await Api.get('/api/messages/' + user.id);
        if (!chat || chat.user !== user) return;
        list.innerHTML = '';
        if (!r.messages.length) list.appendChild(h('p', { class: 'chat-empty' }, 'Say hi to ' + user.username + '! 👋'));
        addMessages(r.messages, true);
        older.hidden = r.messages.length < 50;
        markRead();
      } catch (e) {
        list.innerHTML = '';
        list.appendChild(h('p', { class: 'acct-error' }, e.message));
      }
    })();

    chat.timer = setInterval(poll, 3000);
    setTimeout(() => text.focus(), 50);
  }

  async function poll() {
    if (!chat || document.visibilityState !== 'visible') return;
    const c = chat;
    try {
      const r = await Api.get('/api/messages/' + c.user.id + '?after=' + c.lastId);
      if (chat !== c) return;
      if (r.messages.length) { addMessages(r.messages, false); markRead(); }
    } catch (e) {
      if (e.status === 403) { UI.toast('You are no longer friends with ' + c.user.username + '.'); closeChat(); }
    }
  }

  function markRead() {
    if (!chat) return;
    const id = chat.user.id;
    Api.post('/api/messages/' + id + '/read').then(() => {
      const c = Object.assign({}, Account.counts);
      const n = (c.unreadBy && c.unreadBy[id]) || 0;
      if (n) {
        c.unreadBy = Object.assign({}, c.unreadBy); delete c.unreadBy[id];
        c.unread = Math.max(0, c.unread - n);
        Account.setCounts(c);
      }
      const f = data.friends.find(x => x.id === id); if (f) f.unread = 0;
    }).catch(() => {});
  }

  function messageEl(msg) {
    const mine = msg.from === Account.user.id;
    const bubble = h('div', { class: 'chat-bubble' });
    if (msg.deleted) bubble.appendChild(h('em', { class: 'chat-deleted' }, 'Message deleted'));
    if (msg.attachment) {
      if (msg.attachment.expired) {
        bubble.appendChild(h('div', { class: 'chat-expired' }, '🖼️ This image expired'));
      } else {
        const src = Api.media(msg.attachment.key);
        const img = h('img', { src, alt: 'Image', loading: 'lazy', class: 'chat-img' });
        if (msg.attachment.w && msg.attachment.h) {
          const w = Math.min(240, msg.attachment.w);
          img.style.width = w + 'px';
          img.style.aspectRatio = msg.attachment.w + ' / ' + msg.attachment.h;
        }
        img.onerror = () => img.replaceWith(h('div', { class: 'chat-expired' }, '🖼️ This image expired'));
        bubble.appendChild(h('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, img));
      }
    }
    if (msg.body) bubble.appendChild(h('div', { class: 'chat-body' }, msg.body));

    const time = new Date(msg.at * 1000);
    const row = h('div', { class: 'chat-msg ' + (mine ? 'mine' : 'theirs'), 'data-id': msg.id, title: time.toLocaleString() },
      bubble);
    if (!msg.deleted) {
      const tools = h('div', { class: 'chat-tools' });
      if (mine) {
        tools.appendChild(h('button', { title: 'Delete', onclick: async () => {
          if (!confirm('Delete this message?')) return;
          try {
            await Api.del('/api/messages/item/' + msg.id);
            row.replaceWith(messageEl(Object.assign({}, msg, { deleted: true, body: '', attachment: null })));
          } catch (e) { UI.toast(e.message, 'bad'); }
        }, html: '<i class="fa-solid fa-trash"></i>' }));
      } else {
        tools.appendChild(h('button', { title: 'Report', onclick: () => Profile.report(chat.user, msg.id), html: '<i class="fa-solid fa-flag"></i>' }));
      }
      row.appendChild(tools);
    }
    return row;
  }

  function dayLabel(ts) {
    const d = new Date(ts * 1000), today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  function addMessages(msgs, forceScroll) {
    if (!chat || !msgs.length) return;
    const list = chat.list;
    const scroller = list.parentNode;
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const empty = list.querySelector('.chat-empty'); if (empty) empty.remove();
    msgs.forEach(m => {
      if (chat.ids.has(m.id)) return;
      chat.ids.add(m.id);
      const day = dayLabel(m.at);
      if (list.dataset.lastDay !== day) {
        list.appendChild(h('div', { class: 'chat-day' }, day));
        list.dataset.lastDay = day;
      }
      list.appendChild(messageEl(m));
      chat.lastId = Math.max(chat.lastId, m.id);
      if (!chat.firstId || m.id < chat.firstId) chat.firstId = m.id;
    });
    if (forceScroll || nearBottom) {
      scroller.scrollTop = scroller.scrollHeight;
      // images load later and change height
      list.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', () => { if (forceScroll) scroller.scrollTop = scroller.scrollHeight; }, { once: true }); });
    }
  }

  function prependMessages(msgs) {
    if (!chat || !msgs.length) return;
    const list = chat.list;
    const frag = document.createDocumentFragment();
    let lastDay = null;
    msgs.forEach(m => {
      if (chat.ids.has(m.id)) return;
      chat.ids.add(m.id);
      const day = dayLabel(m.at);
      if (day !== lastDay) { frag.appendChild(h('div', { class: 'chat-day' }, day)); lastDay = day; }
      frag.appendChild(messageEl(m));
      if (m.id < chat.firstId) chat.firstId = m.id;
    });
    // drop the duplicate day divider at the old top
    const firstOld = list.firstElementChild;
    if (firstOld && firstOld.classList.contains('chat-day') && firstOld.textContent === lastDay) firstOld.remove();
    list.insertBefore(frag, list.firstChild);
  }

  function closeChat(silent) {
    if (!chat) return;
    clearInterval(chat.timer);
    if (chat.attachment) URL.revokeObjectURL(chat.attachment.url);
    chat = null;
    if (!silent) { renderList(); refreshList(); }
  }

  /* ------------------------------------------------------------- events */

  document.addEventListener('boinga:user', e => { if (!e.detail) close(); });
  document.addEventListener('boinga:friendschanged', () => { if (drawer && drawer.classList.contains('open')) refreshList(); });
  // Keep the open friends list's unread badges in sync with heartbeats
  document.addEventListener('boinga:counts', e => {
    if (!drawer || !drawer.classList.contains('open') || chat) return;
    const by = e.detail.unreadBy || {};
    let changed = false;
    data.friends.forEach(f => { const n = by[f.id] || 0; if (n !== f.unread) { f.unread = n; changed = true; } });
    if (changed || e.detail.requests !== data.incoming.length) refreshList();
  });
  // Close the drawer when a game opens
  document.addEventListener('boinga:gameopen', () => close());

  window.Social = { open, close, openChat };
})();
