/* =====================================================================
   Accounts: shared helpers (window.UI), login state (window.Account),
   the top-left account corner, sign up / log in, first-visit prompt.
   ===================================================================== */
(function () {
  const cfg = window.BOINGA_CONFIG || {};

  /* ---------------------------------------------------------- helpers */

  // h('div', {class: 'x', onclick: fn}, 'text', childNode...) — text is always escaped
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v; // only ever used with constant markup
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => x && el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x));
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  function nameColor(user) {
    return user && user.nameHue !== null && user.nameHue !== undefined ? 'hsl(' + user.nameHue + ', 95%, 64%)' : '';
  }

  function nameEl(user, extraClass) {
    // The site creator gets a crown + glowing gold name (set by the server, can't be faked)
    if (user && user.admin) {
      return h('span', { class: 'acct-name admin' + (extraClass ? ' ' + extraClass : ''), title: 'BoingaGames creator' },
        h('span', { class: 'acct-crown', 'aria-label': 'Creator' }, '👑'), user.username);
    }
    const el = h('span', { class: 'acct-name' + (extraClass ? ' ' + extraClass : '') }, user.username);
    const c = nameColor(user);
    if (c) el.style.color = c;
    return el;
  }

  function avatarEl(user, size, withStatus) {
    const wrap = h('span', { class: 'acct-avatar', style: { width: size + 'px', height: size + 'px' } });
    const img = h('img', { alt: '', draggable: 'false' });
    if (user.avatar && Api.media(user.avatar)) {
      img.src = Api.media(user.avatar);
    } else {
      img.src = 'boinga.gif';
      img.style.filter = 'hue-rotate(' + (user.avatarHue || 0) + 'deg)';
      img.classList.add('default');
    }
    img.onerror = () => { img.onerror = null; img.src = 'boinga.gif'; img.style.filter = 'hue-rotate(' + (user.avatarHue || 0) + 'deg)'; };
    wrap.appendChild(img);
    if (withStatus) wrap.appendChild(h('span', { class: 'acct-dot ' + (user.status || 'offline'), title: statusLabel(user.status) }));
    return wrap;
  }

  function statusLabel(s) {
    return s === 'active' ? 'Active' : s === 'away' ? 'Away' : 'Offline';
  }

  function ago(ts) {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }

  // One line like "Playing Vex" / "Away" / "Just went to Club Penguin"
  function statusLine(user) {
    if (user.status !== 'offline' && user.game) return 'Playing ' + user.game.name;
    if (user.status !== 'offline' && user.music) return '🎵 Listening to ' + user.music.title + (user.music.artist ? ' — ' + user.music.artist : '');
    if (user.external) return 'Just went to ' + user.external.name + ' · ' + ago(user.external.at);
    return statusLabel(user.status);
  }

  // Group chat icon: uploaded image, or a colour-shifted Boinga like profile pictures
  function groupIconEl(group, size) {
    const wrap = h('span', { class: 'acct-avatar group-icon', style: { width: size + 'px', height: size + 'px' } });
    const img = h('img', { alt: '', draggable: 'false' });
    const fallback = () => { img.src = 'boinga.gif'; img.style.filter = 'hue-rotate(' + (group.iconHue || 0) + 'deg)'; img.classList.add('default'); };
    if (group.icon && Api.media(group.icon)) img.src = Api.media(group.icon); else fallback();
    img.onerror = () => { img.onerror = null; fallback(); };
    wrap.appendChild(img);
    return wrap;
  }

  /* ---------- modals ---------- */
  const openModals = [];
  function modal(opts) {
    const panel = h('div', { class: 'settings-panel acct-panel' + (opts.wide ? ' wide' : '') + (opts.className ? ' ' + opts.className : '') });
    const overlay = h('div', { class: 'overlay active acct-overlay' }, panel);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      overlay.remove();
      const i = openModals.indexOf(api); if (i >= 0) openModals.splice(i, 1);
      if (!document.querySelector('.acct-overlay')) document.body.classList.remove('acct-modal-open');
      if (opts.onClose) opts.onClose();
    }
    if (opts.closable !== false) {
      panel.appendChild(h('span', { class: 'settings-close-btn', title: 'Close', onclick: close }, '×'));
      overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    }
    if (opts.title) panel.appendChild(h('h2', null, opts.title));
    if (opts.body) panel.appendChild(opts.body);
    document.body.appendChild(overlay);
    document.body.classList.add('acct-modal-open');
    const api = { el: panel, overlay: overlay, close: close, closable: opts.closable !== false };
    openModals.push(api);
    return api;
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && openModals.length) {
      const top = openModals[openModals.length - 1];
      if (top.closable) top.close();
    }
  });

  function toast(msg, kind) {
    let box = document.getElementById('acctToasts');
    if (!box) { box = h('div', { id: 'acctToasts' }); document.body.appendChild(box); }
    const t = h('div', { class: 'acct-toast ' + (kind || '') }, msg);
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  function errorBox() {
    const el = h('div', { class: 'acct-error', role: 'alert', hidden: true });
    el.show = msg => { el.textContent = msg; el.hidden = !msg; };
    return el;
  }

  // Disable a button while a promise runs
  async function busy(btn, fn) {
    if (btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true;
    btn.classList.add('loading');
    try { return await fn(); }
    finally { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = old; }
  }

  // Check an image file's type, size and pixel dimensions before uploading
  function checkImage(file, rule) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file chosen.'));
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return reject(new Error('Only PNG, JPG, GIF or WebP images are allowed.'));
      if (file.size > rule.maxMB * 1048576) return reject(new Error('That file is too big (max ' + rule.maxMB + ' MB).'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (img.naturalWidth < rule.minW || img.naturalHeight < rule.minH) {
          reject(new Error('Image must be at least ' + rule.minW + '×' + rule.minH + ' pixels (yours is ' + img.naturalWidth + '×' + img.naturalHeight + ').'));
        } else resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image couldn't be read.")); };
      img.src = url;
    });
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  // Lets a floating window be dragged by its handle. canDrag() decides when dragging is allowed.
  // Position is remembered per key. While dragging, game iframes ignore the mouse so it doesn't get "stuck".
  function makeDraggable(el, handle, key, canDrag) {
    const storeKey = 'boinga.pos.' + key;
    function clamp(x, y) {
      const w = el.offsetWidth, hgt = el.offsetHeight;
      return [Math.max(4, Math.min(x, window.innerWidth - w - 4)), Math.max(4, Math.min(y, window.innerHeight - hgt - 4))];
    }
    function apply(x, y) {
      [x, y] = clamp(x, y);
      el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    }
    handle.addEventListener('pointerdown', e => {
      if (!canDrag() || e.button !== 0 || e.target.closest('button, input, textarea, a, select')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      document.body.classList.add('dragging');
      const move = ev => apply(ev.clientX - dx, ev.clientY - dy);
      const up = () => {
        document.body.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        try { localStorage.setItem(storeKey, JSON.stringify([parseInt(el.style.left, 10), parseInt(el.style.top, 10)])); } catch (err) {}
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    return {
      // put it back where the user last left it (or the CSS default)
      restore() {
        let pos = null;
        try { pos = JSON.parse(localStorage.getItem(storeKey)); } catch (err) {}
        if (pos && canDrag()) requestAnimationFrame(() => apply(pos[0], pos[1]));
        else this.reset();
      },
      reset() { el.style.left = el.style.top = el.style.right = el.style.bottom = ''; }
    };
  }

  // Small right-click / long-press style menu at the mouse position
  function contextMenu(x, y, items) {
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
    const menu = h('div', { class: 'acct-menu ctx-menu', role: 'menu' });
    items.filter(Boolean).forEach(it => menu.appendChild(h('button', { class: 'acct-menu-item' + (it.danger ? ' danger' : ''), onclick: () => { menu.remove(); it.run(); } }, it.label)));
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
    setTimeout(() => {
      const off = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off, true); } };
      document.addEventListener('mousedown', off, true);
    }, 0);
    return menu;
  }

  window.UI = { h, nameEl, nameColor, avatarEl, groupIconEl, statusLabel, statusLine, ago, modal, toast, errorBox, busy, checkImage, fmtTime, makeDraggable, contextMenu,
    IMAGE_RULES: {
      avatar: { maxMB: 4, minW: 128, minH: 128 },
      banner: { maxMB: 6, minW: 600, minH: 150 },
      chat: { maxMB: 8, minW: 1, minH: 1 },
      group: { maxMB: 4, minW: 128, minH: 128 }
    } };

  /* ------------------------------------------------------ account state */

  const Account = {
    user: null,
    counts: { requests: 0, unread: 0, unreadBy: {}, groupUnread: {} },
    // What the server says to switch off right now (data saver)
    saver: { level: 0, heartbeat: 45, chatPoll: 3, uploads: true, music: true, media: true, notice: null },
    setUser(user) {
      Account.user = user;
      renderCorner();
      document.dispatchEvent(new CustomEvent('boinga:user', { detail: user }));
    },
    setCounts(c) {
      Account.counts = { requests: c.requests || 0, unread: c.unread || 0, unreadBy: c.unreadBy || {}, groupUnread: c.groupUnread || Account.counts.groupUnread || {} };
      if (c.saver) Account.setSaver(c.saver);
      renderBadges();
      document.dispatchEvent(new CustomEvent('boinga:counts', { detail: Account.counts }));
    },
    setSaver(s) {
      const changed = JSON.stringify(s) !== JSON.stringify(Account.saver);
      Account.saver = Object.assign({}, Account.saver, s);
      Api.mediaOn = Account.saver.media !== false;
      if (changed) { renderSaverNotice(); document.dispatchEvent(new CustomEvent('boinga:saver', { detail: Account.saver })); }
    },
    async logout() {
      try { await Api.post('/api/auth/logout', {}, { noLogout: true }); } catch (e) {}
      Api.setToken('');
      Account.setUser(null);
      document.dispatchEvent(new CustomEvent('boinga:loggedout', { detail: {} }));
    }
  };
  window.Account = Account;

  document.addEventListener('boinga:loggedout', e => {
    if (Account.user) {
      Account.user = null;
      renderCorner();
      document.dispatchEvent(new CustomEvent('boinga:user', { detail: null }));
      if (e.detail && e.detail.expired) toast('You were logged out. Please log in again.');
    }
  });

  /* ------------------------------------------------------ corner button */

  const corner = document.getElementById('accountCorner');
  let menuOpen = false;

  function renderCorner() {
    if (!corner) return;
    corner.innerHTML = '';
    if (!Api.enabled) return;
    const u = Account.user;
    if (!u) {
      corner.appendChild(h('button', { class: 'acct-cta', onclick: () => openAuth('signup') },
        h('span', { class: 'acct-cta-icon', html: '<i class="fa-solid fa-user"></i>' }), 'Sign up / Log in'));
      return;
    }
    const me = h('button', { class: 'acct-me', title: 'Your account', onclick: toggleMenu },
      avatarEl(u, 34, true), nameEl(u), h('span', { class: 'acct-caret' }, '▾'));
    const friends = h('button', { class: 'acct-icon-btn', id: 'acctFriendsBtn', title: 'Friends & messages',
      onclick: () => window.Social && Social.open() },
      h('span', { html: '<i class="fa-solid fa-comments"></i>' }), h('span', { class: 'acct-badge', id: 'acctBadge', hidden: true }));
    const community = h('button', { class: 'acct-icon-btn', id: 'acctCommunityBtn', title: 'Community chat (everyone on BoingaGames)',
      onclick: () => window.Social && Social.openCommunity() },
      h('span', { html: '<i class="fa-solid fa-globe"></i>' }));
    corner.appendChild(me);
    corner.appendChild(friends);
    corner.appendChild(community);
    renderBadges();
  }

  function renderBadges() {
    const b = document.getElementById('acctBadge');
    if (!b) return;
    const n = Account.counts.requests + Account.counts.unread;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
  }

  function toggleMenu(e) {
    e.stopPropagation();
    const old = document.getElementById('acctMenu');
    if (old) { old.remove(); menuOpen = false; return; }
    const u = Account.user;
    const item = (icon, label, fn, cls) => h('button', { class: 'acct-menu-item' + (cls ? ' ' + cls : ''), onclick: () => { menu.remove(); menuOpen = false; fn(); } },
      h('i', { class: icon }), label);
    const menu = h('div', { id: 'acctMenu', class: 'acct-menu' },
      h('div', { class: 'acct-menu-head' }, avatarEl(u, 40, true),
        h('div', null, nameEl(u), h('div', { class: 'acct-sub' }, u.settings.appearOffline ? 'Appearing offline' : UI.statusLine(u)))),
      item('fa-solid fa-id-badge', 'My profile', () => Profile.view(u.username)),
      item('fa-solid fa-pen', 'Edit profile', () => Profile.edit()),
      item('fa-solid fa-user-group', 'Friends & messages', () => Social.open()),
      u.admin ? item('fa-solid fa-crown', 'Admin panel', () => window.AdminPanel && AdminPanel.open()) : null,
      item('fa-solid fa-right-from-bracket', 'Log out', () => Account.logout().then(() => toast('Logged out. See ya!')), 'danger'));
    corner.appendChild(menu);
    menuOpen = true;
  }
  document.addEventListener('click', e => {
    if (!menuOpen) return;
    const m = document.getElementById('acctMenu');
    if (m && !m.contains(e.target)) { m.remove(); menuOpen = false; }
  });

  /* ------------------------------------------------------ sign up / log in */

  function passwordField(id, placeholder, autocomplete) {
    const input = h('input', { type: 'password', id, placeholder, autocomplete, maxlength: 128, required: true });
    const eye = h('button', { type: 'button', class: 'acct-eye', title: 'Show password', onclick: () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      eye.textContent = input.type === 'password' ? '👁' : '🙈';
    } }, '👁');
    return { wrap: h('div', { class: 'acct-pw' }, input, eye), input };
  }

  function openAuth(mode) {
    if (!Api.enabled) return;
    let m;
    const body = h('div', { class: 'acct-auth' });
    const tabs = h('div', { class: 'seg acct-tabs' });
    const signupBtn = h('button', { onclick: () => show('signup') }, 'Create account');
    const loginBtn = h('button', { onclick: () => show('login') }, 'Log in');
    tabs.appendChild(signupBtn);
    tabs.appendChild(loginBtn);
    const content = h('div');
    body.appendChild(tabs);
    body.appendChild(content);

    function show(which) {
      signupBtn.classList.toggle('active', which === 'signup');
      loginBtn.classList.toggle('active', which === 'login');
      content.innerHTML = '';
      content.appendChild(which === 'signup' ? signupForm() : loginForm());
      const first = content.querySelector('input');
      if (first) setTimeout(() => first.focus(), 30);
    }

    function signupForm() {
      const err = errorBox();
      const user = h('input', { type: 'text', id: 'suUser', placeholder: 'Username', autocomplete: 'username', maxlength: 20, spellcheck: 'false' });
      const hint = h('div', { class: 'acct-hint' }, '3–20 characters: letters, numbers and _');
      const pw = passwordField('suPass', 'Password (8+ characters)', 'new-password');
      const pw2 = passwordField('suPass2', 'Type it again', 'new-password');
      const age = h('input', { type: 'checkbox', id: 'suAge' });
      const agree = h('input', { type: 'checkbox', id: 'suAgree' });
      const btn = h('button', { type: 'submit', class: 'acct-btn primary wide' }, 'Create account');

      let checkTimer = null;
      user.addEventListener('input', () => {
        clearTimeout(checkTimer);
        const v = user.value.trim();
        hint.className = 'acct-hint';
        if (!v) { hint.textContent = '3–20 characters: letters, numbers and _'; return; }
        if (!/^[A-Za-z0-9_]{3,20}$/.test(v)) { hint.textContent = '3–20 characters: letters, numbers and _'; hint.classList.add('bad'); return; }
        hint.textContent = 'Checking…';
        checkTimer = setTimeout(async () => {
          try {
            const r = await Api.get('/api/auth/available?username=' + encodeURIComponent(v));
            if (user.value.trim() !== v) return;
            hint.textContent = r.available ? '✓ ' + v + ' is available!' : r.reason;
            hint.classList.add(r.available ? 'good' : 'bad');
          } catch (e) { hint.textContent = ''; }
        }, 400);
      });

      const form = h('form', { class: 'acct-form', onsubmit: async e => {
        e.preventDefault();
        err.show('');
        if (pw.input.value !== pw2.input.value) return err.show("Those passwords don't match.");
        if (pw.input.value.length < 8) return err.show('Password must be at least 8 characters.');
        if (!age.checked) return err.show('You must be 13 or older to make an account.');
        if (!agree.checked) return err.show('You need to agree to the Terms of Service and Privacy Policy.');
        await busy(btn, async () => {
          btn.textContent = 'Creating…';
          try {
            const r = await Api.post('/api/auth/signup', { username: user.value.trim(), password: pw.input.value, age13: true, agree: true });
            Api.setToken(r.token);
            Account.setUser(r.user);
            m.close();
            welcome(r.user);
          } catch (ex) { err.show(ex.message); }
        });
      } },
        h('p', { class: 'acct-lead' }, 'No email required! Just pick a name and a password.'),
        user, hint, pw.wrap, pw2.wrap,
        h('div', { class: 'acct-warn' },
          h('strong', null, '⚠ There is no way to recover a forgotten password.'),
          ' Since there\'s no email, nobody (not even us) can reset it. Write it down or save it in your browser\'s password manager.'),
        h('label', { class: 'acct-check' }, age, h('span', null, 'I am 13 years old or older')),
        h('label', { class: 'acct-check' }, agree, h('span', null, 'I agree to the ',
          h('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, 'Terms of Service'), ' and ',
          h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy Policy'))),
        err, btn);
      return form;
    }

    function loginForm() {
      const err = errorBox();
      const user = h('input', { type: 'text', id: 'liUser', placeholder: 'Username', autocomplete: 'username', maxlength: 20, spellcheck: 'false' });
      const pw = passwordField('liPass', 'Password', 'current-password');
      const btn = h('button', { type: 'submit', class: 'acct-btn primary wide' }, 'Log in');
      return h('form', { class: 'acct-form', onsubmit: async e => {
        e.preventDefault();
        err.show('');
        await busy(btn, async () => {
          btn.textContent = 'Logging in…';
          try {
            const r = await Api.post('/api/auth/login', { username: user.value.trim(), password: pw.input.value });
            Api.setToken(r.token);
            Account.setUser(r.user);
            m.close();
            toast('Welcome back, ' + r.user.username + '!', 'good');
          } catch (ex) { err.show(ex.message); }
        });
      } },
        user, pw.wrap, err, btn,
        h('p', { class: 'acct-hint center' }, 'Forgot your password? Sorry, there\'s no way to recover it. You can always make a new account.'));
    }

    m = modal({ title: 'BoingaGames Account', body, className: 'acct-auth-panel' });
    show(mode || 'signup');
  }

  function welcome(user) {
    const body = h('div', { class: 'acct-welcome' },
      avatarEl(Object.assign({}, user, { status: 'active' }), 96, false),
      h('p', null, 'Welcome to BoingaGames, ', nameEl(user), '!'),
      h('p', { class: 'acct-hint center' }, 'Your profile picture is a one-of-a-kind Boinga. You can change it, add a banner, a bio and a name colour any time.'));
    const m = modal({ title: 'Account created! 🎉', body });
    body.appendChild(h('div', { class: 'acct-row-btns' },
      h('button', { class: 'acct-btn primary', onclick: () => { m.close(); Profile.edit(); } }, 'Customize profile'),
      h('button', { class: 'acct-btn', onclick: () => { m.close(); Social.open('add'); } }, 'Find friends'),
      h('button', { class: 'acct-btn ghost', onclick: () => m.close() }, 'Play games')));
  }

  /* ------------------------------------------------------ first visit */

  const ASK_KEY = 'boinga.signupPrompt'; // 'never' or a timestamp of "ask me later"
  function maybeAskToSignUp() {
    if (!Api.enabled || cfg.ASK_TO_SIGN_UP === false || Account.user || Api.getToken()) return;
    let v; try { v = localStorage.getItem(ASK_KEY); } catch (e) { return; }
    if (v === 'never') return;
    if (v && Date.now() - Number(v) < 7 * 86400e3) return;
    if (document.getElementById('gameOverlay').classList.contains('active')) return;

    const remember = val => { try { localStorage.setItem(ASK_KEY, val); } catch (e) {} };
    const body = h('div', { class: 'acct-prompt' },
      h('img', { src: 'boinga.gif', alt: '', class: 'acct-prompt-boinga' }),
      h('p', { class: 'acct-prompt-big' }, 'Want to make a BoingaGames account?'),
      h('ul', { class: 'acct-prompt-list' },
        h('li', null, '🎨 Your own profile, banner and name colour'),
        h('li', null, '👋 Add friends and see what they\'re playing'),
        h('li', null, '💬 Chat with friends (images and GIFs too)')),
      h('p', { class: 'acct-prompt-free' }, 'No email required!'));
    const m = modal({ title: 'Hey there!', body, onClose: () => { if (!chosen) remember(String(Date.now())); } });
    let chosen = false;
    body.appendChild(h('div', { class: 'acct-row-btns' },
      h('button', { class: 'acct-btn primary', onclick: () => { chosen = true; remember('never'); m.close(); openAuth('signup'); } }, 'Create account'),
      h('button', { class: 'acct-btn', onclick: () => { chosen = true; remember('never'); m.close(); openAuth('login'); } }, 'I have one'),
      h('button', { class: 'acct-btn ghost', onclick: () => { chosen = true; remember(String(Date.now())); m.close(); } }, 'Maybe later')));
    body.appendChild(h('button', { class: 'acct-link', onclick: () => { chosen = true; remember('never'); m.close(); } }, "Don't ask me again"));
  }

  /* ------------------------------------------------------ data saver notice */

  function renderSaverNotice() {
    let bar = document.getElementById('saverNotice');
    const s = Account.saver;
    const key = 'boinga.saverDismissed';
    let dismissed = '';
    try { dismissed = localStorage.getItem(key) || ''; } catch (e) {}
    const today = new Date().toISOString().slice(0, 10);
    if (!s.notice || dismissed === today + ':' + s.level) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = h('div', { id: 'saverNotice', role: 'status' });
      document.body.appendChild(bar);
    }
    bar.innerHTML = '';
    bar.appendChild(h('span', null, '🌱 ' + s.notice));
    bar.appendChild(h('button', { title: 'Hide', onclick: () => {
      try { localStorage.setItem(key, today + ':' + s.level); } catch (e) {}
      bar.remove();
    } }, '×'));
  }

  async function loadStatus() {
    try { const r = await Api.get('/api/status'); Account.setSaver(r.saver); } catch (e) {}
  }

  /* ------------------------------------------------------ boot */

  async function boot() {
    if (!Api.enabled) return;
    document.documentElement.classList.add('accounts-on');
    renderCorner();
    loadStatus();
    if (Api.getToken()) {
      try {
        const r = await Api.get('/api/me');
        Account.setUser(r.user);
      } catch (e) {
        if (e.status !== 401) {
          // Server unreachable: keep the token and try again later.
          setTimeout(boot, 30000);
        }
      }
    } else {
      setTimeout(maybeAskToSignUp, 1200);
    }
  }

  window.AuthUI = { open: openAuth };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
