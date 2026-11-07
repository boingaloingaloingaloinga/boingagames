/* Admin panel for the site creator. Every action is checked on the server (users.is_admin),
   so this file being public doesn't let anyone else in. window.AdminPanel.open() */
(function () {
  const { h } = window.UI;

  function fmtNum(n) { return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0); }
  function fmtBytes(b) { return b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + ' GB' : (b / 1024 ** 2).toFixed(1) + ' MB'; }

  function open() {
    if (!Account.user || !Account.user.admin) return;
    let tab = 'overview';
    const tabs = h('div', { class: 'seg admin-tabs' });
    const body = h('div', { class: 'admin-body' });
    const wrap = h('div', { class: 'admin' }, tabs, body);
    UI.modal({ title: '👑 Admin panel', body: wrap, wide: true, className: 'admin-panel' });
    const names = { overview: 'Overview', reports: 'Reports', users: 'Users' };
    function drawTabs() {
      tabs.innerHTML = '';
      Object.keys(names).forEach(k => tabs.appendChild(h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; drawTabs(); show(); } }, names[k])));
    }
    function show() {
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'acct-loading' }, 'Loading…'));
      ({ overview, reports, users })[tab](body).catch(e => { body.innerHTML = ''; body.appendChild(h('p', { class: 'acct-error' }, e.message)); });
    }
    drawTabs();
    show();
  }

  /* ---------------- overview + data saver ---------------- */
  async function overview(body) {
    const r = await Api.get('/api/admin/overview');
    body.innerHTML = '';
    const c = r.counts;
    const stat = (label, v) => h('div', { class: 'stat-card' }, h('span', { class: 'stat-value' }, String(v)), h('span', { class: 'stat-label' }, label));
    body.appendChild(h('div', { class: 'admin-stats' },
      stat('Users', c.users), stat('Online now', c.online), stat('Groups', c.groups),
      stat('Messages (24h)', c.messages24h), stat('Open reports', c.openReports), stat('Banned', c.banned)));

    const s = r.saver || {};
    const sec = h('section', { class: 'edit-sec' }, h('h3', null, '🌱 Data saver (Cloudflare free limits)'));
    const levelName = ['Off', 'Saving', 'Heavy saving'][s.level || 0];
    sec.appendChild(h('p', { class: 'admin-level lvl' + (s.level || 0) }, 'Level: ' + levelName +
      (s.override !== null && s.override !== undefined ? ' (set by you)' : ' (automatic)') +
      (s.reasons && s.reasons.length ? ' — ' + s.reasons.join(', ') : '')));
    if (s.usage && s.limits) {
      const u = s.usage, L = s.limits;
      const bar = (label, val, lim, fmt) => {
        const pct = Math.min(100, (val / lim) * 100);
        return h('div', { class: 'admin-bar' },
          h('div', { class: 'admin-bar-label' }, h('span', null, label), h('span', null, (fmt || fmtNum)(val) + ' / ' + (fmt || fmtNum)(lim))),
          h('div', { class: 'admin-bar-track' }, h('span', { class: pct >= 88 ? 'hot' : pct >= 70 ? 'warm' : '', style: { width: pct + '%' } })));
      };
      sec.appendChild(bar('Worker requests today', u.workers, L.workers));
      sec.appendChild(bar('Database writes today', u.d1Writes, L.d1Writes));
      sec.appendChild(bar('Database reads today', u.d1Reads, L.d1Reads));
      sec.appendChild(bar('Image storage', u.r2Bytes, L.r2Bytes, fmtBytes));
      sec.appendChild(bar('Uploads this month (R2 class A)', u.r2A, L.r2A));
      sec.appendChild(bar('Image views this month (R2 class B)', u.r2B, L.r2B));
      sec.appendChild(h('p', { class: 'acct-hint' }, 'Checked ' + UI.ago(s.checkedAt) + '. Workers and database limits reset at midnight UTC.'));
    }
    if (s.error) sec.appendChild(h('p', { class: 'acct-warn' }, s.error));
    const set = level => async () => {
      try { await Api.post('/api/admin/saver', { level }); UI.toast('Data saver updated', 'good'); overview(body); }
      catch (e) { UI.toast(e.message, 'bad'); }
    };
    const btn = (label, fn, cls) => { const b = h('button', { class: 'acct-btn small ' + (cls || '') }, label); b.addEventListener('click', () => UI.busy(b, fn)); return b; };
    sec.appendChild(h('div', { class: 'acct-row-btns left' },
      btn('Automatic', set(null), 'primary'), btn('Force off', set(0)), btn('Force saving', set(1)), btn('Force heavy', set(2)),
      btn('Check now', async () => { try { await Api.post('/api/admin/usage-check'); overview(body); } catch (e) { UI.toast(e.message, 'bad'); } })));
    body.appendChild(sec);
  }

  /* ---------------- reports ---------------- */
  async function reports(body, status) {
    status = status || 'open';
    const r = await Api.get('/api/admin/reports?status=' + status);
    body.innerHTML = '';
    body.appendChild(h('div', { class: 'acct-row-btns left' },
      h('button', { class: 'acct-btn small' + (status === 'open' ? ' primary' : ''), onclick: () => reports(body, 'open') }, 'Open'),
      h('button', { class: 'acct-btn small' + (status === 'done' ? ' primary' : ''), onclick: () => reports(body, 'done') }, 'Closed')));
    if (!r.reports.length) { body.appendChild(h('p', { class: 'acct-empty' }, 'No ' + status + ' reports. 🎉')); return; }
    r.reports.forEach(rep => {
      const card = h('div', { class: 'admin-report' },
        h('div', { class: 'admin-report-head' },
          h('strong', null, rep.reporter || '(deleted)'), ' reported ', h('strong', null, rep.target || '(deleted)'),
          rep.targetBanned ? h('span', { class: 'admin-tag' }, 'banned') : null,
          h('span', { class: 'acct-hint' }, ' · ' + UI.ago(rep.at))),
        h('p', { class: 'admin-reason' }, rep.reason));
      if (rep.message) {
        const m = rep.message;
        const box = h('div', { class: 'admin-msg' }, h('small', null, (m.groupId ? 'Group chat message' : 'Direct message') + (m.deleted ? ' (deleted)' : '')));
        if (m.rawBody) box.appendChild(h('div', null, m.rawBody));
        if (m.gif) box.appendChild(h('img', { src: m.gif.url, alt: 'GIF' }));
        if (m.attachment && m.attachment.key) box.appendChild(h('img', { src: Api.base + '/media/' + m.attachment.key, alt: 'Image' }));
        card.appendChild(box);
      }
      const act = (label, fn, cls) => { const b = h('button', { class: 'acct-btn small ' + (cls || '') }, label); b.addEventListener('click', () => UI.busy(b, async () => { try { await fn(); } catch (e) { UI.toast(e.message, 'bad'); } })); return b; };
      card.appendChild(h('div', { class: 'acct-row-btns left' },
        rep.message && !rep.message.deleted ? act('Delete message', async () => { await Api.del('/api/admin/messages/' + rep.message.id); UI.toast('Message deleted'); reports(body, status); }, 'danger') : null,
        rep.targetId && !rep.targetBanned ? act('Ban ' + rep.target, async () => {
          if (!confirm('Ban ' + rep.target + '? They get logged out and can\'t log back in.')) return;
          await Api.post('/api/admin/users/' + rep.targetId + '/ban', { banned: true }); UI.toast('Banned'); reports(body, status);
        }, 'danger') : null,
        rep.target ? act('View profile', async () => Profile.view(rep.target)) : null,
        act(status === 'open' ? 'Close report' : 'Reopen', async () => { await Api.post('/api/admin/reports/' + rep.id, { status: status === 'open' ? 'done' : 'open' }); reports(body, status); }, 'primary')));
      body.appendChild(card);
    });
  }

  /* ---------------- users ---------------- */
  async function users(body) {
    body.innerHTML = '';
    const input = h('input', { type: 'search', placeholder: 'Search usernames (empty = newest)', maxlength: 20 });
    const list = h('div');
    body.appendChild(input);
    body.appendChild(list);
    async function load() {
      list.innerHTML = '';
      try {
        const r = await Api.get('/api/admin/users?q=' + encodeURIComponent(input.value.trim()));
        r.users.forEach(u => list.appendChild(userRow(u, load)));
        if (!r.users.length) list.appendChild(h('p', { class: 'acct-empty' }, 'Nobody found.'));
      } catch (e) { list.appendChild(h('p', { class: 'acct-error' }, e.message)); }
    }
    let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
    load();
  }

  function userRow(u, reload) {
    const act = (label, fn, cls) => { const b = h('button', { class: 'acct-btn small ' + (cls || '') }, label); b.addEventListener('click', () => UI.busy(b, async () => { try { await fn(); reload(); } catch (e) { UI.toast(e.message, 'bad'); } })); return b; };
    const clear = field => act('Clear ' + field, async () => {
      if (!confirm('Clear ' + u.username + "'s " + field + '?')) return;
      await Api.post('/api/admin/users/' + u.id + '/clear', { fields: [field] });
    });
    return h('div', { class: 'admin-user' },
      UI.avatarEl(Object.assign({ status: 'offline' }, u), 40, false),
      h('div', { class: 'social-row-main' },
        h('div', null, UI.nameEl(u), u.banned ? h('span', { class: 'admin-tag' }, 'banned') : null),
        h('div', { class: 'acct-hint' }, '#' + u.id + ' · joined ' + new Date(u.createdAt * 1000).toLocaleDateString() + (u.bio ? ' · “' + u.bio.slice(0, 60) + '”' : ''))),
      u.admin ? h('span', { class: 'acct-hint' }, 'admin') : h('div', { class: 'admin-actions' },
        act('Profile', async () => Profile.view(u.username)),
        u.banned ? act('Unban', async () => Api.post('/api/admin/users/' + u.id + '/ban', { banned: false }), 'primary')
          : act('Ban', async () => { if (confirm('Ban ' + u.username + '?')) await Api.post('/api/admin/users/' + u.id + '/ban', { banned: true }); }, 'danger'),
        u.avatar ? clear('avatar') : null, u.banner ? clear('banner') : null, u.bio ? clear('bio') : null, clear('username')));
  }

  window.AdminPanel = { open };
})();
