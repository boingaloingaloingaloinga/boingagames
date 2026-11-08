/* =====================================================================
   Friends drawer: friends, group chats, requests, add people,
   and the chat view (direct messages + group chats share it).
   window.Social = { open, close, openChat(user), openGroup(id), shareTo(onPick) }
   ===================================================================== */
(function () {
  const { h } = window.UI;

  let drawer = null, content = null;
  let tab = 'friends';
  let data = { friends: [], incoming: [], outgoing: [] };
  let gdata = { groups: [], invites: [] };
  let listTimer = null;
  let chat = null; // the open conversation
  const GROUP_MIN = 3, GROUP_MAX = 15;

  const pollSec = () => Math.max(3, (Account.saver && Account.saver.chatPoll) || 3);
  // Community chat is busier and has no notifications, so it checks less often (saves server requests)
  const pollMs = () => (chat && chat.kind === 'community' ? Math.max(6, pollSec() * 2) : pollSec()) * 1000;
  const uploadsOn = () => !Account.saver || Account.saver.uploads !== false;

  /* ============================================================ DRAWER */

  let drag = null;
  let compactPref = false;
  try { compactPref = localStorage.getItem('boinga.chatCompact') === '1'; } catch (e) {}
  const inGame = () => document.body.classList.contains('in-game');
  const isFloating = () => !!drawer && drawer.classList.contains('floating');

  function ensureDrawer() {
    if (drawer) return;
    drawer = h('aside', { id: 'socialDrawer', class: 'social', 'aria-label': 'Friends and messages' });
    content = h('div', { class: 'social-content' });
    drawer.appendChild(content);
    document.body.appendChild(drawer);
    drawer.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('.acct-overlay')) close(); });
    // Floating window can be dragged by its title bar
    drag = UI.makeDraggable(drawer, drawer, 'chat', () => isFloating());
    applyMode();
  }

  // Floating (small window, works on top of games) vs. full side drawer
  function applyMode() {
    if (!drawer) return;
    const floating = inGame() || compactPref;
    const was = isFloating();
    drawer.classList.toggle('floating', floating);
    if (floating && !was) drag.restore();
    if (!floating) drag.reset();
    content.querySelectorAll('.social-compact').forEach(b => {
      b.innerHTML = Icon(floating ? 'expand' : 'compress');
      b.title = floating ? 'Full size' : 'Compact (small floating chat)';
      b.hidden = inGame(); // always small while a game is open
    });
  }
  function toggleCompact() {
    compactPref = !compactPref;
    try { localStorage.setItem('boinga.chatCompact', compactPref ? '1' : '0'); } catch (e) {}
    applyMode();
  }

  function open(which) {
    if (!Account.user) return AuthUI.open('login');
    ensureDrawer();
    if (which) tab = which;
    drawer.classList.add('open');
    document.body.classList.add('social-open');
    applyMode();
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
      const [f, g] = await Promise.all([Api.get('/api/friends'), Api.get('/api/groups')]);
      data = f; gdata = g;
      if (!chat && drawer && drawer.classList.contains('open')) renderList();
    } catch (e) { /* shown on next render */ }
  }

  function compactBtn() {
    return h('button', { class: 'social-mini social-compact', onclick: toggleCompact });
  }
  function header(title, left) {
    const head = h('div', { class: 'social-head' },
      left || null,
      h('h2', null, title),
      compactBtn(),
      h('button', { class: 'social-x', title: 'Close', onclick: close }, '×'));
    return head;
  }

  function renderList() {
    if (!content) return;
    content.innerHTML = '';
    content.appendChild(header('Friends'));
    setTimeout(applyMode, 0);
    const reqCount = data.incoming.length + gdata.invites.length;
    const groupUnread = gdata.groups.reduce((n, g) => n + (g.unread || 0), 0);
    const tabBtn = (key, label, badge) => h('button', { class: tab === key ? 'active' : '', onclick: () => { tab = key; renderList(); } },
      label, badge ? h('span', { class: 'acct-badge inline' }, String(badge)) : null);
    content.appendChild(h('div', { class: 'seg social-tabs' },
      tabBtn('friends', 'Friends', data.friends.reduce((n, f) => n + (f.unread || 0), 0)),
      tabBtn('groups', 'Groups', groupUnread),
      tabBtn('requests', 'Requests', reqCount),
      tabBtn('add', 'Add')));
    const body = h('div', { class: 'social-body' });
    content.appendChild(body);
    if (tab === 'friends') friendsTab(body);
    else if (tab === 'groups') groupsTab(body);
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

  function communityRow() {
    const row = h('div', { class: 'social-row clickable community-row' },
      h('span', { class: 'community-icon', html: Icon('globe') }),
      h('div', { class: 'social-row-main' }, h('span', { class: 'acct-name group-name' }, 'Community chat'),
        h('div', { class: 'social-sub' }, 'Everyone on BoingaGames')));
    row.addEventListener('click', openCommunity);
    return row;
  }

  function friendsTab(body) {
    body.appendChild(communityRow());
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

  function groupRow(g, right, onclick) {
    const sub = g.active
      ? g.memberCount + ' members'
      : 'Waiting for people to join (' + g.memberCount + '/' + GROUP_MIN + ')';
    const row = h('div', { class: 'social-row' + (onclick ? ' clickable' : '') },
      UI.groupIconEl(g, 40),
      h('div', { class: 'social-row-main' }, h('span', { class: 'acct-name group-name' }, g.name), h('div', { class: 'social-sub' }, sub)),
      right || null);
    if (onclick) row.addEventListener('click', e => { if (!e.target.closest('button')) onclick(); });
    return row;
  }

  function groupsTab(body) {
    body.appendChild(h('button', { class: 'acct-btn primary wide social-new-group', onclick: newGroup }, '＋ New group chat'));
    if (!gdata.groups.length) {
      body.appendChild(h('p', { class: 'social-empty' }, 'No group chats yet. Make one with 2 to 14 of your friends!'));
      return;
    }
    gdata.groups.forEach(g => {
      body.appendChild(groupRow(g, g.unread ? h('span', { class: 'acct-badge inline' }, String(g.unread)) : null, () => openGroup(g.id)));
    });
  }

  function requestsTab(body) {
    if (!data.incoming.length && !data.outgoing.length && !gdata.invites.length) {
      body.appendChild(h('p', { class: 'social-empty' }, 'No requests or invites right now.'));
      return;
    }
    if (gdata.invites.length) body.appendChild(h('div', { class: 'social-group' }, 'Group chat invites'));
    gdata.invites.forEach(g => {
      const yes = h('button', { class: 'acct-btn small primary' }, 'Join');
      const no = h('button', { class: 'acct-btn small' }, 'Decline');
      yes.addEventListener('click', () => UI.busy(yes, async () => {
        try { await Api.post('/api/groups/' + g.id + '/respond', { accept: true }); UI.toast('You joined ' + g.name + '!', 'good'); await refreshList(); Presence.beat(true); }
        catch (e) { UI.toast(e.message, 'bad'); }
      }));
      no.addEventListener('click', () => UI.busy(no, async () => {
        try { await Api.post('/api/groups/' + g.id + '/respond', { accept: false }); await refreshList(); Presence.beat(true); }
        catch (e) { UI.toast(e.message, 'bad'); }
      }));
      const who = g.members.map(m => m.username).slice(0, 3).join(', ') + (g.members.length > 3 ? '…' : '');
      const row = groupRow(g, h('div', { class: 'social-right' }, yes, no));
      row.querySelector('.social-sub').textContent = 'With ' + who;
      body.appendChild(row);
    });
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

  /* ========================================================= GROUPS */

  // Friend picker used by "New group" and "Invite friends"
  function friendPicker(exclude, max) {
    const chosen = new Set();
    const counter = h('span', { class: 'acct-hint' });
    const filter = h('input', { type: 'search', placeholder: 'Filter friends…', maxlength: 20 });
    const list = h('div', { class: 'pick-list' });
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      list.innerHTML = '';
      const friends = data.friends.filter(f => !exclude.has(f.id) && f.username.toLowerCase().includes(q));
      if (!friends.length) list.appendChild(h('p', { class: 'acct-hint center' }, data.friends.length ? 'No matching friends.' : 'Add some friends first!'));
      friends.forEach(f => {
        const box = h('input', { type: 'checkbox' });
        box.checked = chosen.has(f.id);
        box.addEventListener('change', () => {
          if (box.checked && chosen.size >= max) { box.checked = false; UI.toast('That\'s the most people a group can have.'); return; }
          box.checked ? chosen.add(f.id) : chosen.delete(f.id);
          counter.textContent = chosen.size + ' selected';
        });
        list.appendChild(h('label', { class: 'pick-row' }, box, UI.avatarEl(f, 30, true), UI.nameEl(f)));
      });
    };
    filter.addEventListener('input', draw);
    draw();
    counter.textContent = '0 selected';
    return { el: h('div', { class: 'pick' }, filter, list, counter), chosen };
  }

  async function newGroup() {
    if (!data.friends.length) await refreshList();
    const err = UI.errorBox();
    const name = h('input', { type: 'text', maxlength: 40, placeholder: 'Group name' });
    const picker = friendPicker(new Set(), GROUP_MAX - 1);
    const btn = h('button', { class: 'acct-btn primary wide' }, 'Create group');
    const body = h('div', { class: 'acct-form' },
      name,
      h('p', { class: 'acct-hint' }, 'Pick 2 to 14 friends. Everyone has to accept the invite, and the chat opens once 3 people are in.'),
      picker.el, err, btn);
    const m = UI.modal({ title: 'New group chat', body });
    setTimeout(() => name.focus(), 30);
    btn.addEventListener('click', () => UI.busy(btn, async () => {
      err.show('');
      if (picker.chosen.size < GROUP_MIN - 1) return err.show('Pick at least 2 friends.');
      try {
        const r = await Api.post('/api/groups', { name: name.value, userIds: [...picker.chosen] });
        m.close();
        UI.toast('Group created! Invites sent.', 'good');
        await refreshList();
        openGroup(r.group.id);
      } catch (e) { err.show(e.message); }
    }));
  }

  async function groupInfo(groupId) {
    const body = h('div', { class: 'ginfo' }, h('div', { class: 'acct-loading' }, 'Loading…'));
    const m = UI.modal({ title: 'Group', body, wide: true });
    async function load() {
      let g;
      try { g = (await Api.get('/api/groups/' + groupId)).group; } catch (e) { body.innerHTML = ''; body.appendChild(h('p', { class: 'acct-error' }, e.message)); return; }
      render(g);
      if (chat && chat.kind === 'group' && chat.id === g.id) setChatGroup(g);
    }
    function render(g) {
      body.innerHTML = '';
      const isOwner = g.ownerId === Account.user.id;
      const act = (label, cls, fn) => {
        const b = h('button', { class: 'acct-btn small ' + (cls || '') }, label);
        b.addEventListener('click', () => UI.busy(b, async () => { try { await fn(); } catch (e) { UI.toast(e.message, 'bad'); } }));
        return b;
      };

      // Icon + name
      const iconInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
      iconInput.addEventListener('change', async () => {
        const file = iconInput.files[0]; iconInput.value = '';
        if (!file) return;
        try {
          await UI.checkImage(file, UI.IMAGE_RULES.group);
          if (isOwner) { await Api.post('/api/groups/' + g.id + '/icon', file); UI.toast('Group icon changed!', 'good'); }
          else { await Api.post('/api/groups/' + g.id + '/suggest-icon', file); UI.toast('Icon suggested! The owner will decide.', 'good'); }
          load();
        } catch (e) { UI.toast(e.message, 'bad'); }
      });
      const nameInput = h('input', { type: 'text', maxlength: 40, value: g.name });
      const iconBtns = h('div', { class: 'acct-row-btns left' },
        act(isOwner ? 'Change icon' : 'Suggest icon', '', async () => {
          if (!uploadsOn()) throw new Error('Uploads are paused right now to keep BoingaGames free.');
          iconInput.click();
        }),
        isOwner && g.icon ? act('Remove icon', '', async () => { await Api.del('/api/groups/' + g.id + '/icon'); load(); }) : null);
      body.appendChild(h('section', { class: 'edit-sec' },
        h('div', { class: 'ginfo-top' }, UI.groupIconEl(g, 84),
          h('div', { class: 'ginfo-name' },
            h('div', { class: 'edit-inline' }, nameInput,
              act(isOwner ? 'Rename' : 'Suggest', 'primary', async () => {
                if (isOwner) { await Api.patch('/api/groups/' + g.id, { name: nameInput.value }); UI.toast('Renamed!', 'good'); }
                else { await Api.post('/api/groups/' + g.id + '/suggest', { name: nameInput.value }); UI.toast('Name suggested! The owner will decide.', 'good'); }
                load();
              })),
            h('p', { class: 'acct-hint' }, isOwner ? 'You made this group, so you can rename it, change the icon and remove people.'
              : 'Only the group owner can change the name and icon, but you can suggest new ones.'),
            iconBtns)),
        iconInput));

      // Suggestions (owner decides)
      if (isOwner && g.suggestions && g.suggestions.length) {
        const sec = h('section', { class: 'edit-sec' }, h('h3', null, 'Suggestions'));
        g.suggestions.forEach(s => sec.appendChild(suggestionRow(g, s, load)));
        body.appendChild(sec);
      }

      // Members
      const mem = h('section', { class: 'edit-sec' }, h('h3', null, 'Members (' + g.memberCount + '/' + GROUP_MAX + ')'));
      if (!g.active) mem.appendChild(h('p', { class: 'acct-hint' }, 'Chat opens once at least 3 people have joined.'));
      g.members.forEach(u => {
        const right = h('div', { class: 'social-right' },
          u.id === g.ownerId ? h('span', { class: 'ginfo-owner' }, 'Owner') : null,
          isOwner && u.id !== Account.user.id ? act('Remove', 'danger', async () => {
            if (!confirm('Remove ' + u.username + ' from the group?')) return;
            await Api.post('/api/groups/' + g.id + '/kick', { userId: u.id }); load();
          }) : null);
        mem.appendChild(personRow(u, UI.statusLine(u), right, () => Profile.view(u.username)));
      });
      if (g.invited.length) {
        mem.appendChild(h('div', { class: 'social-group' }, 'Invited (waiting)'));
        g.invited.forEach(u => {
          mem.appendChild(personRow(u, 'Hasn\'t joined yet', isOwner ? h('div', { class: 'social-right' },
            act('Cancel', '', async () => { await Api.post('/api/groups/' + g.id + '/kick', { userId: u.id }); load(); })) : null));
        });
      }
      if (isOwner) {
        mem.appendChild(act('Invite friends', 'primary', async () => {
          if (!data.friends.length) await refreshList();
          const exclude = new Set(g.members.concat(g.invited).map(u => u.id));
          const picker = friendPicker(exclude, GROUP_MAX - exclude.size);
          const err = UI.errorBox();
          const send = h('button', { class: 'acct-btn primary wide' }, 'Send invites');
          const im = UI.modal({ title: 'Invite friends', body: h('div', { class: 'acct-form' }, picker.el, err, send) });
          send.addEventListener('click', () => UI.busy(send, async () => {
            try { await Api.post('/api/groups/' + g.id + '/invite', { userIds: [...picker.chosen] }); im.close(); UI.toast('Invites sent!', 'good'); load(); }
            catch (e) { err.show(e.message); }
          }));
        }));
      }
      body.appendChild(mem);

      // Leave
      body.appendChild(h('section', { class: 'edit-sec' },
        act('Leave group', 'danger', async () => {
          const msg = isOwner && g.memberCount > 1 ? 'Leave the group? The longest-standing member becomes the new owner.' : 'Leave the group?';
          if (!confirm(msg)) return;
          await Api.post('/api/groups/' + g.id + '/leave');
          m.close();
          if (chat && chat.kind === 'group' && chat.id === g.id) closeChat();
          refreshList();
        })));
    }
    load();
  }

  function suggestionRow(g, s, after) {
    const yes = h('button', { class: 'acct-btn small primary' }, 'Use it');
    const no = h('button', { class: 'acct-btn small' }, 'Pass');
    const decide = accept => async () => {
      try { await Api.post('/api/groups/' + g.id + '/suggestions/' + s.id, { accept }); after && after(); }
      catch (e) { UI.toast(e.message, 'bad'); }
    };
    yes.addEventListener('click', () => UI.busy(yes, decide(true)));
    no.addEventListener('click', () => UI.busy(no, decide(false)));
    return h('div', { class: 'sugg-row' },
      s.kind === 'icon' ? h('img', { class: 'sugg-icon', src: Api.media(s.value) || 'boinga.gif', alt: '' }) : h('span', { class: 'sugg-name' }, '“' + s.value + '”'),
      s.by ? h('span', { class: 'acct-hint' }, 'from ' + s.by) : null,
      h('div', { class: 'social-right' }, yes, no));
  }

  /* ========================================================== CHAT */

  function openChat(user) {
    startChat({ kind: 'dm', id: user.id, user,
      path: '/api/messages/' + user.id, readPath: '/api/messages/' + user.id + '/read' });
  }

  async function openGroup(id) {
    let g = gdata.groups.find(x => x.id === id);
    try { g = (await Api.get('/api/groups/' + id)).group; } catch (e) { if (!g) return UI.toast(e.message, 'bad'); }
    startChat({ kind: 'group', id: g.id, group: g,
      path: '/api/groups/' + g.id + '/messages', readPath: '/api/groups/' + g.id + '/read' });
  }

  function setChatGroup(g) {
    if (!chat || chat.kind !== 'group') return;
    chat.group = g;
    chat.members = new Map(g.members.concat(g.invited).map(u => [u.id, u]));
    chat.pending = new Set((g.suggestions || []).map(s => s.id));
    if (chat.headTitle) { chat.headTitle.textContent = g.name; chat.headSub.textContent = g.memberCount + ' members'; }
    if (chat.headIcon) { const icon = UI.groupIconEl(g, 34); chat.headIcon.replaceWith(icon); chat.headIcon = icon; }
    updateComposerLock();
    // keep suggestion buttons in sync: remove answered ones, add ones that are still waiting
    const isOwner = g.ownerId === Account.user.id;
    chat.list.querySelectorAll('.chat-system[data-suggestion]').forEach(el => {
      const sid = Number(el.dataset.suggestion);
      const btns = el.querySelector('.sugg-btns');
      if (btns && (!chat.pending.has(sid) || !isOwner)) btns.remove();
      if (!btns && isOwner && chat.pending.has(sid)) {
        const s = (g.suggestions || []).find(x => x.id === sid);
        if (s) { const row = suggestionRow(g, s, refreshOpenGroup); row.classList.add('sugg-btns'); el.appendChild(row); }
      }
    });
  }

  async function refreshOpenGroup() {
    if (!chat || chat.kind !== 'group') return;
    const c = chat;
    try { const g = (await Api.get('/api/groups/' + c.id)).group; if (chat === c) setChatGroup(g); } catch (e) {}
    poll();
  }

  function updateComposerLock() {
    if (!chat || !chat.composer) return;
    const locked = chat.kind === 'group' && !chat.group.active;
    chat.composer.classList.toggle('locked', locked);
    chat.lockNote.hidden = !locked;
    if (locked) chat.lockNote.textContent = 'This chat opens once at least 3 people have joined (' + chat.group.memberCount + '/' + GROUP_MIN + ' so far).';
    chat.attachBtn.disabled = !uploadsOn();
    chat.attachBtn.title = uploadsOn() ? 'Attach an image or GIF file' : 'Image uploads are paused right now (data saver). GIFs still work!';
  }

  function startChat(conv) {
    if (!Account.user) return;
    open();
    closeChat(true);
    content.innerHTML = '';
    const back = h('button', { class: 'social-back', title: 'Back', onclick: () => closeChat() }, '‹');
    let who;
    conv.headIcon = null;
    if (conv.kind === 'community') {
      conv.headSub = h('div', { class: 'social-sub' }, 'Everyone on BoingaGames');
      who = h('div', { class: 'chat-who' },
        h('span', { class: 'community-icon small', html: Icon('globe') }),
        h('div', null, h('span', { class: 'acct-name group-name' }, 'Community'), conv.headSub));
    } else if (conv.kind === 'dm') {
      who = h('button', { class: 'chat-who', onclick: () => Profile.view(conv.user.username) },
        UI.avatarEl(conv.user, 34, true),
        h('div', null, UI.nameEl(conv.user), h('div', { class: 'social-sub ' + conv.user.status }, UI.statusLine(conv.user))));
    } else {
      conv.headIcon = UI.groupIconEl(conv.group, 34);
      conv.headTitle = h('span', { class: 'acct-name group-name' }, conv.group.name);
      conv.headSub = h('div', { class: 'social-sub' }, conv.group.memberCount + ' members');
      who = h('button', { class: 'chat-who', title: 'Group info', onclick: () => groupInfo(conv.id) },
        conv.headIcon, h('div', null, conv.headTitle, conv.headSub));
    }
    const head = h('div', { class: 'social-head chat-head' }, back, who,
      conv.kind === 'group' ? h('button', { class: 'social-mini', title: 'Group info', onclick: () => groupInfo(conv.id), html: '<i class="fa-solid fa-circle-info"></i>' }) : null,
      compactBtn(),
      h('button', { class: 'social-x', title: 'Close', onclick: close }, '×'));

    const list = h('div', { class: 'chat-list' }, h('div', { class: 'acct-loading' }, 'Loading…'));
    const older = h('button', { class: 'chat-older', hidden: true }, 'Load older messages');

    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
    const attachBtn = h('button', { class: 'chat-attach', title: 'Attach an image', onclick: () => fileInput.click(), html: '<i class="fa-solid fa-image"></i>' });
    const gifBtn = h('button', { class: 'chat-attach chat-gif-btn', title: 'Send a GIF' }, 'GIF');
    const text = h('textarea', { class: 'chat-text', rows: 1, maxlength: conv.kind === 'community' ? 500 : 1000,
      placeholder: conv.kind === 'dm' ? 'Message ' + conv.user.username + '…' : conv.kind === 'group' ? 'Message ' + conv.group.name + '…' : 'Say something to everyone…' });
    if (conv.kind === 'community') attachBtn.hidden = true;
    const sendBtn = h('button', { class: 'chat-send', title: 'Send', html: '<i class="fa-solid fa-paper-plane"></i>' });
    const pending = h('div', { class: 'chat-pending', hidden: true });
    const err = UI.errorBox();
    const lockNote = h('div', { class: 'chat-lock', hidden: true });
    const composer = h('div', { class: 'chat-compose' }, lockNote, pending, err,
      h('div', { class: 'chat-compose-row' }, attachBtn, gifBtn, text, sendBtn), fileInput,
      h('div', { class: 'chat-note' }, conv.kind === 'community'
        ? 'Be nice! One message every 10 seconds. Right-click someone to add them as a friend.'
        : 'Uploaded images are deleted from the server after a while to save space.'));

    content.appendChild(head);
    content.appendChild(h('div', { class: 'chat-scroll' }, older, list));
    content.appendChild(composer);
    applyMode();

    chat = Object.assign(conv, { lastId: 0, firstId: 0, list, text, attachment: null, timer: null, ids: new Set(),
      composer, lockNote, attachBtn, sendBtn, members: new Map(), pending: new Set(), lastSender: null, cooldownUntil: 0 });
    if (conv.kind === 'group') setChatGroup(conv.group); else updateComposerLock();
    const scroller = list.parentNode;

    text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 120) + 'px'; });
    text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    sendBtn.addEventListener('click', () => send());
    gifBtn.addEventListener('click', () => GifPicker.open(gifBtn, gif => send({ gif })));

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
    async function send(extra) {
      if (sending || !chat) return;
      if (chat.cooldownUntil > Date.now()) { err.show('Slow down! Wait a few seconds between community messages.'); return; }
      const body = extra ? '' : text.value.trim();
      if (!extra && !body && !chat.attachment) return;
      sending = true;
      sendBtn.disabled = true;
      err.show('');
      try {
        const payload = Object.assign({ body }, extra || {});
        if (!extra && chat.attachment) {
          if (!chat.attachment.key) chat.attachment.key = (await Api.post('/api/upload/chat', chat.attachment.file)).key;
          payload.attachment = chat.attachment.key;
        }
        const r = await Api.post(chat.path, payload);
        if (!extra) { text.value = ''; text.style.height = 'auto'; clearAttachment(); }
        if (r.sender) chat.members.set(r.sender.id, r.sender);
        addMessages([r.message], true);
        if (r.nextAt) startCooldown(r.nextAt * 1000);
      } catch (e) {
        err.show(e.message);
      } finally {
        sending = false;
        if (!(chat && chat.cooldownUntil > Date.now())) sendBtn.disabled = false;
        text.focus();
      }
    }
    chat.send = send;

    older.addEventListener('click', () => UI.busy(older, async () => {
      const r = await Api.get(chat.path + '?before=' + chat.firstId);
      mergeSenders(r);
      const prevH = scroller.scrollHeight;
      prependMessages(r.messages);
      scroller.scrollTop = scroller.scrollHeight - prevH;
      older.hidden = r.messages.length < 50;
    }));

    const c = chat;
    (async function initial() {
      try {
        const r = await Api.get(c.path);
        if (chat !== c) return;
        mergeSenders(r);
        if (c.kind === 'community' && typeof r.online === 'number') c.headSub.textContent = 'Everyone on BoingaGames · ' + r.online + ' online';
        list.innerHTML = '';
        if (!r.messages.length) list.appendChild(h('p', { class: 'chat-empty' }, c.kind === 'dm' ? 'Say hi to ' + c.user.username + '! 👋' : c.kind === 'group' ? 'Say hi to the group! 👋' : "It's quiet in here… say hi to everyone! 👋"));
        addMessages(r.messages, true);
        older.hidden = r.messages.length < 50;
        markRead();
      } catch (e) {
        list.innerHTML = '';
        list.appendChild(h('p', { class: 'acct-error' }, e.message));
      }
    })();

    schedulePoll();
    setTimeout(() => text.focus(), 50);
  }

  function mergeSenders(r) {
    if (chat && r && r.senders) Object.keys(r.senders).forEach(id => chat.members.set(Number(id), r.senders[id]));
  }

  function startCooldown(until) {
    if (!chat) return;
    const c = chat;
    c.cooldownUntil = until;
    const tick = () => {
      if (chat !== c) return;
      const left = Math.ceil((c.cooldownUntil - Date.now()) / 1000);
      if (left > 0) {
        c.sendBtn.disabled = true;
        c.sendBtn.textContent = String(left);
        setTimeout(tick, 250);
      } else {
        c.sendBtn.disabled = false;
        c.sendBtn.innerHTML = Icon('paper-plane');
      }
    };
    tick();
  }

  function openCommunity() {
    if (!Account.user) return AuthUI.open('signup');
    startChat({ kind: 'community', id: 0, path: '/api/community/messages', readPath: null });
  }

  function schedulePoll() {
    if (!chat) return;
    clearTimeout(chat.timer);
    chat.timer = setTimeout(async () => { await poll(); schedulePoll(); }, pollMs());
  }

  async function poll() {
    if (!chat || document.visibilityState !== 'visible') return;
    const c = chat;
    try {
      const r = await Api.get(c.path + '?after=' + c.lastId);
      if (chat !== c) return;
      mergeSenders(r);
      if (r.messages.length) {
        // something changed in the group (join/leave/rename/suggestion): refresh details first
        if (c.kind === 'group' && r.messages.some(m => m.kind === 'system')) {
          try { const g = (await Api.get('/api/groups/' + c.id)).group; if (chat === c) setChatGroup(g); } catch (e) {}
        }
        if (chat !== c) return;
        addMessages(r.messages, false);
        markRead();
      }
    } catch (e) {
      if (e.status === 403) {
        UI.toast(c.kind === 'dm' ? 'You are no longer friends with ' + c.user.username + '.' : "You're no longer in this group.");
        closeChat();
      }
    }
  }

  function markRead() {
    if (!chat || !chat.readPath) return;
    const c = chat;
    Api.post(c.readPath).then(() => {
      const counts = Object.assign({}, Account.counts);
      const bag = c.kind === 'dm' ? 'unreadBy' : 'groupUnread';
      const n = (counts[bag] && counts[bag][c.id]) || 0;
      if (n) {
        counts[bag] = Object.assign({}, counts[bag]); delete counts[bag][c.id];
        counts.unread = Math.max(0, counts.unread - n);
        Account.setCounts(counts);
      }
      const f = (c.kind === 'dm' ? data.friends : gdata.groups).find(x => x.id === c.id); if (f) f.unread = 0;
    }).catch(() => {});
  }

  function senderOf(id) {
    if (Account.user && id === Account.user.id) return Account.user;
    if (chat && chat.kind === 'dm' && chat.user.id === id) return chat.user;
    return (chat && chat.members.get(id)) || { id, username: 'Former member', avatarHue: 0, status: 'offline' };
  }

  function messageEl(msg) {
    if (msg.kind === 'system') {
      const el = h('div', { class: 'chat-system' }, msg.body);
      const meta = msg.meta || {};
      if (meta.suggestion) {
        el.dataset.suggestion = meta.suggestion;
        if (meta.kind === 'icon' && Api.media(meta.value)) el.appendChild(h('img', { class: 'sugg-icon', src: Api.media(meta.value), alt: '' }));
        const isOwner = chat && chat.kind === 'group' && chat.group.ownerId === Account.user.id;
        if (isOwner && chat.pending.has(meta.suggestion)) {
          const s = { id: meta.suggestion, kind: meta.kind, value: meta.value, by: '' };
          const row = suggestionRow(chat.group, s, refreshOpenGroup);
          row.classList.add('sugg-btns');
          el.appendChild(row);
        }
      }
      return el;
    }
    const mine = msg.from === Account.user.id;
    const bubble = h('div', { class: 'chat-bubble' });
    if (msg.deleted) bubble.appendChild(h('em', { class: 'chat-deleted' }, 'Message deleted'));
    if (msg.attachment) {
      if (msg.attachment.expired || !Api.media(msg.attachment.key)) {
        bubble.appendChild(h('div', { class: 'chat-expired' }, msg.attachment.expired ? '🖼️ This image expired' : '🖼️ Image hidden (data saver)'));
      } else {
        const src = Api.media(msg.attachment.key);
        const img = h('img', { src, alt: 'Image', loading: 'lazy', class: 'chat-img' });
        if (msg.attachment.w && msg.attachment.h) {
          img.style.width = Math.min(240, msg.attachment.w) + 'px';
          img.style.aspectRatio = msg.attachment.w + ' / ' + msg.attachment.h;
        }
        img.onerror = () => img.replaceWith(h('div', { class: 'chat-expired' }, '🖼️ This image expired'));
        bubble.appendChild(h('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, img));
      }
    }
    if (msg.gif) {
      const img = h('img', { src: msg.gif.url, alt: 'GIF', loading: 'lazy', class: 'chat-img chat-gif' });
      if (msg.gif.w && msg.gif.h) {
        img.style.width = Math.min(220, msg.gif.w) + 'px';
        img.style.aspectRatio = msg.gif.w + ' / ' + msg.gif.h;
      }
      bubble.classList.add('has-gif');
      bubble.appendChild(img);
    }
    if (msg.kind === 'playlist' && msg.meta) {
      const p = msg.meta;
      bubble.classList.add('has-card');
      bubble.appendChild(h('button', { class: 'chat-playlist', onclick: () => window.Music && Music.openPlaylist(p.id) },
        p.cover ? h('img', { src: p.cover, alt: '' }) : h('span', { class: 'chat-playlist-noimg' }, '🎵'),
        h('span', { class: 'chat-playlist-text' },
          h('small', null, 'Playlist'), h('strong', null, p.name), h('span', null, p.count + ' songs · by ' + p.by)),
        h('span', { class: 'chat-playlist-open' }, 'Open')));
    }
    if (msg.body) bubble.appendChild(h('div', { class: 'chat-body' }, msg.body));

    const time = new Date(msg.at * 1000);
    const row = h('div', { class: 'chat-msg ' + (mine ? 'mine' : 'theirs'), 'data-id': msg.id, 'data-from': msg.from, title: time.toLocaleString() });
    // In groups and community, show who's talking when the sender changes
    if (chat && (chat.kind === 'group' || chat.kind === 'community') && !mine) {
      const u = senderOf(msg.from);
      const showName = chat.lastSender !== msg.from;
      const wrap = h('div', { class: 'chat-from' },
        showName ? h('button', { class: 'chat-from-name', onclick: () => u.username !== 'Former member' && Profile.view(u.username) }, UI.nameEl(u)) : null,
        bubble);
      row.appendChild(showName ? UI.avatarEl(u, 26, false) : h('span', { class: 'chat-avatar-space' }));
      row.appendChild(wrap);
    } else {
      row.appendChild(bubble);
    }
    if (chat) chat.lastSender = msg.from;
    if (!mine && chat && chat.kind !== 'dm') {
      // Right-click (or long-press) someone for friend / profile / block / report
      row.addEventListener('contextmenu', e => { e.preventDefault(); personMenu(e.clientX, e.clientY, senderOf(msg.from), msg, row); });
    }
    if (!msg.deleted) {
      const tools = h('div', { class: 'chat-tools' });
      if (mine) {
        tools.appendChild(h('button', { title: 'Delete', onclick: async () => {
          if (!confirm('Delete this message?')) return;
          try {
            await Api.del('/api/messages/item/' + msg.id);
            row.replaceWith(messageEl(Object.assign({}, msg, { deleted: true, body: '', attachment: null, gif: null, kind: 'text' })));
          } catch (e) { UI.toast(e.message, 'bad'); }
        }, html: '<i class="fa-solid fa-trash"></i>' }));
      } else {
        tools.appendChild(h('button', { title: 'Report', onclick: () => Profile.report(senderOf(msg.from), msg.id), html: '<i class="fa-solid fa-flag"></i>' }));
      }
      row.appendChild(tools);
    }
    return row;
  }

  function personMenu(x, y, u, msg, row) {
    if (!u || !u.username || u.username === 'Former member') return;
    const isFriend = data.friends.find(f => f.id === u.id);
    const sent = data.outgoing.some(f => f.id === u.id);
    const theyAsked = data.incoming.some(f => f.id === u.id);
    UI.contextMenu(x, y, [
      { label: '👤 View profile', run: () => Profile.view(u.username) },
      isFriend ? { label: '💬 Message', run: () => openChat(isFriend) }
        : sent ? { label: '⏳ Friend request sent', run: () => UI.toast('Waiting for ' + u.username + ' to accept.') }
        : { label: theyAsked ? '✅ Accept friend request' : '➕ Add friend', run: async () => {
            try {
              const r = await Api.post('/api/friends/request', { username: u.username });
              UI.toast(r.relationship === 'friends' ? 'You and ' + u.username + ' are now friends!' : 'Friend request sent to ' + u.username + '!', 'good');
              refreshList();
            } catch (e) { UI.toast(e.message, 'bad'); }
          } },
      msg ? { label: '🚩 Report message', run: () => Profile.report(u, msg.id) } : null,
      { label: '🚫 Block', danger: true, run: async () => {
          if (!confirm('Block ' + u.username + '? You won\'t see their messages anymore.')) return;
          try {
            await Api.post('/api/blocks', { userId: u.id });
            UI.toast('Blocked ' + u.username);
            if (chat) chat.list.querySelectorAll('.chat-msg').forEach(el => { if (Number(el.dataset.from) === u.id) el.remove(); });
            refreshList();
          } catch (e) { UI.toast(e.message, 'bad'); }
        } },
      Account.user.admin && msg ? { label: '🗑 Delete message (admin)', danger: true, run: async () => {
          try { await Api.del('/api/admin/messages/' + msg.id); if (row) row.remove(); } catch (e) { UI.toast(e.message, 'bad'); }
        } } : null
    ]);
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
        chat.lastSender = null;
      }
      if (m.kind === 'system') chat.lastSender = null;
      list.appendChild(messageEl(m));
      if (m.kind === 'system') chat.lastSender = null;
      chat.lastId = Math.max(chat.lastId, m.id);
      if (!chat.firstId || m.id < chat.firstId) chat.firstId = m.id;
    });
    if (forceScroll || nearBottom) {
      scroller.scrollTop = scroller.scrollHeight;
      list.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', () => { if (forceScroll) scroller.scrollTop = scroller.scrollHeight; }, { once: true }); });
    }
  }

  function prependMessages(msgs) {
    if (!chat || !msgs.length) return;
    const list = chat.list;
    const frag = document.createDocumentFragment();
    let lastDay = null;
    const saved = chat.lastSender;
    chat.lastSender = null;
    msgs.forEach(m => {
      if (chat.ids.has(m.id)) return;
      chat.ids.add(m.id);
      const day = dayLabel(m.at);
      if (day !== lastDay) { frag.appendChild(h('div', { class: 'chat-day' }, day)); lastDay = day; chat.lastSender = null; }
      frag.appendChild(messageEl(m));
      if (m.id < chat.firstId) chat.firstId = m.id;
    });
    chat.lastSender = saved;
    const firstOld = list.firstElementChild;
    if (firstOld && firstOld.classList.contains('chat-day') && firstOld.textContent === lastDay) firstOld.remove();
    list.insertBefore(frag, list.firstChild);
  }

  function closeChat(silent) {
    if (!chat) return;
    clearTimeout(chat.timer);
    if (chat.attachment) URL.revokeObjectURL(chat.attachment.url);
    if (window.GifPicker) GifPicker.close();
    chat = null;
    if (!silent) { renderList(); refreshList(); }
  }

  /* ===================================================== SHARE TO CHAT */

  // Lets the music player share a playlist into a DM or group chat
  async function shareTo(payload, label) {
    if (!Account.user) return AuthUI.open('login');
    await refreshList();
    const body = h('div', { class: 'pick-list share-list' });
    const m = UI.modal({ title: 'Share ' + (label || ''), body });
    const sendTo = (path, name) => async () => {
      try { await Api.post(path, payload); m.close(); UI.toast('Shared with ' + name + '!', 'good'); }
      catch (e) { UI.toast(e.message, 'bad'); }
    };
    if (!data.friends.length && !gdata.groups.length) body.appendChild(h('p', { class: 'acct-hint center' }, 'Add some friends first!'));
    gdata.groups.filter(g => g.active).forEach(g => body.appendChild(groupRow(g, null, sendTo('/api/groups/' + g.id + '/messages', g.name))));
    data.friends.forEach(f => body.appendChild(personRow(f, UI.statusLine(f), null, sendTo('/api/messages/' + f.id, f.username))));
  }

  /* ========================================================== EVENTS */

  document.addEventListener('boinga:user', e => { if (!e.detail) close(); });
  document.addEventListener('boinga:friendschanged', () => { if (drawer && drawer.classList.contains('open')) refreshList(); });
  document.addEventListener('boinga:counts', e => {
    if (!drawer || !drawer.classList.contains('open') || chat) return;
    const by = e.detail.unreadBy || {}, gby = e.detail.groupUnread || {};
    let changed = false;
    data.friends.forEach(f => { const n = by[f.id] || 0; if (n !== f.unread) { f.unread = n; changed = true; } });
    gdata.groups.forEach(g => { const n = gby[g.id] || 0; if (n !== g.unread) { g.unread = n; changed = true; } });
    if (changed || e.detail.requests !== data.incoming.length + gdata.invites.length) refreshList();
  });
  document.addEventListener('boinga:saver', () => { if (chat) updateComposerLock(); });
  document.addEventListener('boinga:gameopen', applyMode);
  document.addEventListener('boinga:gameclose', applyMode);

  window.Social = { open, close, openChat, openGroup, openCommunity, shareTo, isOpen: () => !!drawer && drawer.classList.contains('open') };
})();
