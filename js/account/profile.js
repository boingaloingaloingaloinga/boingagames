/* Profiles: view anyone's profile, edit your own. window.Profile */
(function () {
  const { h } = window.UI;

  /* ================================================= VIEW A PROFILE */

  async function view(username) {
    const body = h('div', { class: 'prof' }, h('div', { class: 'acct-loading' }, 'Loading…'));
    let refresher = null;
    const m = UI.modal({ body, wide: true, className: 'prof-panel', onClose: () => clearInterval(refresher) });

    async function load(first) {
      let user;
      try {
        user = (await Api.get('/api/users/' + encodeURIComponent(username))).user;
      } catch (e) {
        if (first) { body.innerHTML = ''; body.appendChild(h('p', { class: 'acct-empty' }, e.message)); }
        return;
      }
      username = user.username; // follow renames
      render(user);
    }

    function render(u) {
      body.innerHTML = '';
      const isSelf = u.relationship === 'self';

      // Banner
      const banner = h('div', { class: 'prof-banner' });
      if (u.banner) banner.appendChild(h('img', { src: Api.media(u.banner), alt: '' }));
      else banner.style.background = u.nameHue !== null && u.nameHue !== undefined
        ? 'linear-gradient(135deg, hsl(' + u.nameHue + ',60%,35%), hsl(' + ((u.nameHue + 40) % 360) + ',60%,20%))'
        : 'linear-gradient(135deg, #3a3b5b, #1e1e2f)';

      const head = h('div', { class: 'prof-head' },
        UI.avatarEl(u, 104, true),
        h('div', { class: 'prof-actions' }, actions(u)));

      const statusText = isSelf && Account.user && Account.user.settings.appearOffline
        ? 'Appearing offline (only you see this)'
        : UI.statusLine(u);

      const info = h('div', { class: 'prof-info' },
        h('div', { class: 'prof-name' }, UI.nameEl(u)),
        h('div', { class: 'prof-status ' + u.status }, h('span', { class: 'acct-dot inline ' + u.status }), statusText),
        h('div', { class: 'prof-joined' }, 'Joined ' + new Date(u.createdAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })));

      if (u.music) {
        const m = u.music;
        info.appendChild(h('button', { class: 'prof-music', title: 'Play this song', onclick: () => {
          if (window.Music) Music.playOne({ id: m.id, title: m.title, artist: m.artist, cover: m.cover, duration: 0 });
        } },
          m.cover ? h('img', { src: m.cover, alt: '' }) : h('span', { class: 'prof-noimg' }),
          h('span', { class: 'prof-music-text' }, h('small', null, '🎵 Listening to'), h('strong', null, m.title), m.artist ? h('span', null, m.artist) : null),
          h('span', { class: 'prof-music-play' }, '▶')));
      }
      if (u.bio) info.appendChild(h('p', { class: 'prof-bio' }, u.bio));
      else if (isSelf) info.appendChild(h('p', { class: 'prof-bio empty' }, 'No bio yet. Click Edit profile to add one.'));

      // Activity: most played (from the site's stats)
      const act = h('div', { class: 'prof-activity' }, h('h3', null, 'Activity'));
      if (u.activity === null) {
        act.appendChild(h('p', { class: 'acct-empty' }, '🔒 ' + u.username + ' keeps their activity private.'));
      } else if (!u.activity.length) {
        act.appendChild(h('p', { class: 'acct-empty' }, isSelf ? 'Play some games and your most played will show up here!' : 'Nothing here yet.'));
      } else {
        const max = u.activity[0].time || 1;
        u.activity.forEach((a, i) => {
          const g = window.Library && Library.byId[a.id];
          const row = h('div', { class: 'prof-game' + (g ? ' playable' : ''), title: g ? 'Play ' + a.name : '' },
            h('span', { class: 'prof-rank' }, '#' + (i + 1)),
            g ? h('img', { src: g.img, alt: '' }) : h('span', { class: 'prof-noimg' }),
            h('div', { class: 'prof-game-main' },
              h('div', { class: 'prof-game-name' }, a.name),
              h('div', { class: 'prof-bar' }, h('span', { style: { width: Math.max(6, (a.time / max) * 100) + '%' } }))),
            h('span', { class: 'prof-time' }, window.Stats ? Stats.fmt(a.time) : a.time + 's'));
          if (g) row.addEventListener('click', e => { m.close(); Library.launch(g, e); });
          act.appendChild(row);
        });
      }

      // Favorite games (from their star button), clickable to play
      const favs = h('div', { class: 'prof-activity prof-favs' }, h('h3', null, '⭐ Favorite games'));
      if (u.favorites === null) {
        favs.appendChild(h('p', { class: 'acct-empty' }, '🔒 ' + u.username + ' keeps their favorites private.'));
      } else {
        const list = (u.favorites || []).map(id => window.Library && Library.byId[id]).filter(Boolean);
        if (!list.length) favs.appendChild(h('p', { class: 'acct-empty' }, isSelf ? 'Star games on the home page and they show up here!' : 'No favorites yet.'));
        else {
          const grid = h('div', { class: 'prof-fav-grid' });
          list.forEach(g => {
            const t = Library.makeTile(g);
            t.querySelector('.game-star').remove();
            t.addEventListener('click', () => m.close());
            grid.appendChild(t);
          });
          favs.appendChild(grid);
        }
      }

      body.appendChild(banner);
      body.appendChild(head);
      body.appendChild(info);
      body.appendChild(favs);
      body.appendChild(act);
    }

    function actions(u) {
      const btn = (label, cls, fn, icon) => {
        const b = h('button', { class: 'acct-btn ' + (cls || '') }, icon ? h('i', { class: icon }) : null, label);
        b.addEventListener('click', () => UI.busy(b, async () => {
          try { await fn(); } catch (e) { UI.toast(e.message, 'bad'); }
        }));
        return b;
      };
      const refresh = () => load(false);
      const out = [];
      switch (u.relationship) {
        case 'self':
          out.push(btn('Edit profile', 'primary', async () => { m.close(); edit(); }, 'fa-solid fa-pen'));
          return out;
        case 'friends':
          out.push(btn('Message', 'primary', async () => { m.close(); Social.openChat(u); }, 'fa-solid fa-comment'));
          break;
        case 'incoming':
          out.push(btn('Accept', 'primary', async () => { await Api.post('/api/friends/respond', { userId: u.id, accept: true }); UI.toast('You and ' + u.username + ' are now friends!', 'good'); refresh(); }));
          out.push(btn('Decline', '', async () => { await Api.post('/api/friends/respond', { userId: u.id, accept: false }); refresh(); }));
          break;
        case 'outgoing':
          out.push(btn('Request sent · Cancel', '', async () => { await Api.del('/api/friends/' + u.id); refresh(); }));
          break;
        case 'blocked':
          out.push(btn('Unblock', '', async () => { await Api.del('/api/blocks/' + u.id); UI.toast('Unblocked ' + u.username); refresh(); }));
          return out;
        default:
          out.push(btn('Add friend', 'primary', async () => { await Api.post('/api/friends/request', { username: u.username }); UI.toast('Friend request sent!', 'good'); refresh(); }, 'fa-solid fa-user-plus'));
      }
      // ⋯ menu: remove friend, block, report
      const more = h('button', { class: 'acct-btn icon', title: 'More' }, '⋯');
      more.addEventListener('click', e => {
        e.stopPropagation();
        const old = document.querySelector('.prof-more'); if (old) { old.remove(); return; }
        const menu = h('div', { class: 'acct-menu prof-more' });
        const item = (label, fn, cls) => menu.appendChild(h('button', { class: 'acct-menu-item ' + (cls || ''), onclick: async () => {
          menu.remove();
          try { await fn(); } catch (ex) { UI.toast(ex.message, 'bad'); }
        } }, label));
        if (u.relationship === 'friends') item('Remove friend', async () => {
          if (!confirm('Remove ' + u.username + ' from your friends?')) return;
          await Api.del('/api/friends/' + u.id); UI.toast('Removed ' + u.username); refresh();
          document.dispatchEvent(new CustomEvent('boinga:friendschanged'));
        });
        item('Block', async () => {
          if (!confirm('Block ' + u.username + '? They won\'t be able to find you, friend you or message you.')) return;
          await Api.post('/api/blocks', { userId: u.id }); UI.toast('Blocked ' + u.username); refresh();
          document.dispatchEvent(new CustomEvent('boinga:friendschanged'));
        }, 'danger');
        item('Report', async () => report(u), 'danger');
        more.parentNode.appendChild(menu);
        setTimeout(() => document.addEventListener('click', function off(ev) {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', off); }
        }), 0);
      });
      out.push(more);
      return out;
    }

    await load(true);
    refresher = setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 20000);
  }

  function report(u, messageId) {
    const err = UI.errorBox();
    const reason = h('textarea', { maxlength: 500, rows: 4, placeholder: 'What happened? (spam, harassment, inappropriate images…)' });
    const send = h('button', { class: 'acct-btn primary wide' }, 'Send report');
    const body = h('div', { class: 'acct-form' },
      h('p', { class: 'acct-hint' }, 'Reports go to the BoingaGames admin. Blocking them also stops them from contacting you.'),
      reason, err, send);
    const m = UI.modal({ title: 'Report ' + u.username, body });
    send.addEventListener('click', () => UI.busy(send, async () => {
      try {
        await Api.post('/api/report', { userId: u.id, messageId: messageId || null, reason: reason.value });
        m.close();
        UI.toast('Thanks — report sent.', 'good');
      } catch (e) { err.show(e.message); }
    }));
  }

  /* ================================================= EDIT MY PROFILE */

  function edit() {
    const me = Account.user;
    if (!me) return AuthUI.open('login');
    const body = h('div', { class: 'edit' });
    const m = UI.modal({ title: 'Edit profile', body, wide: true, className: 'edit-panel' });

    const section = (title, ...kids) => h('section', { class: 'edit-sec' }, h('h3', null, title), ...kids);
    const set = user => { Account.setUser(user); };

    /* --- picture + banner --- */
    const avatarPrev = h('div', { class: 'edit-avatar-prev' });
    const bannerPrev = h('div', { class: 'edit-banner-prev' });
    function drawPreviews() {
      const u = Account.user;
      avatarPrev.innerHTML = '';
      avatarPrev.appendChild(UI.avatarEl(u, 96, false));
      bannerPrev.innerHTML = '';
      if (u.banner) bannerPrev.appendChild(h('img', { src: Api.media(u.banner), alt: '' }));
      else bannerPrev.appendChild(h('span', null, 'No banner'));
    }
    drawPreviews();

    function uploader(kind, label) {
      const err = UI.errorBox();
      if (Account.saver.uploads === false) setTimeout(() => err.show('Uploads are paused right now to keep BoingaGames free. Try again tomorrow.'), 0);
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
      const pick = h('button', { class: 'acct-btn primary', onclick: () => input.click() }, label);
      input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        err.show('');
        UI.busy(pick, async () => {
          pick.textContent = 'Uploading…';
          try {
            await UI.checkImage(file, UI.IMAGE_RULES[kind]);
            const r = await Api.post('/api/me/' + kind, file);
            set(r.user); drawPreviews();
            UI.toast(kind === 'avatar' ? 'Profile picture updated!' : 'Banner updated!', 'good');
          } catch (e) { err.show(e.message); }
        });
      });
      return { input, pick, err };
    }

    const av = uploader('avatar', 'Upload image / GIF');
    const avReset = h('button', { class: 'acct-btn', onclick: () => UI.busy(avReset, async () => {
      try { const r = await Api.del('/api/me/avatar'); set(r.user); drawPreviews(); } catch (e) { av.err.show(e.message); }
    }) }, 'Use my Boinga');
    const bn = uploader('banner', 'Upload banner');
    const bnReset = h('button', { class: 'acct-btn', onclick: () => UI.busy(bnReset, async () => {
      try { const r = await Api.del('/api/me/banner'); set(r.user); drawPreviews(); } catch (e) { bn.err.show(e.message); }
    }) }, 'Remove');

    body.appendChild(section('Profile picture',
      h('div', { class: 'edit-media' }, avatarPrev,
        h('div', null, h('div', { class: 'acct-row-btns left' }, av.pick, avReset), av.input,
          h('p', { class: 'acct-hint' }, 'PNG, JPG, GIF or WebP · at least 128×128 · max 4 MB'), av.err))));
    body.appendChild(section('Banner',
      bannerPrev,
      h('div', { class: 'acct-row-btns left' }, bn.pick, bnReset), bn.input,
      h('p', { class: 'acct-hint' }, 'At least 600×150 (wide images look best) · max 6 MB · GIFs work too'), bn.err));

    /* --- name colour + bio --- */
    let hue = me.nameHue;
    const namePrev = h('div', { class: 'edit-name-prev' });
    const drawName = () => {
      namePrev.innerHTML = '';
      namePrev.appendChild(UI.nameEl(Object.assign({}, Account.user, { nameHue: hue })));
    };
    drawName();
    const slider = h('input', { type: 'range', min: 0, max: 359, value: hue === null ? 50 : hue, class: 'hue-slider' });
    slider.addEventListener('input', () => { hue = Number(slider.value); drawName(); });
    const themeBtn = h('button', { class: 'acct-btn small', onclick: () => { hue = null; drawName(); } }, 'Use theme colour');

    const bio = h('textarea', { maxlength: 300, rows: 4, placeholder: 'Tell people about yourself…' });
    bio.value = me.bio || '';
    const counter = h('span', { class: 'acct-hint' });
    const count = () => { counter.textContent = bio.value.length + '/300'; };
    bio.addEventListener('input', count); count();

    const saveErr = UI.errorBox();
    const save = h('button', { class: 'acct-btn primary' }, 'Save');
    save.addEventListener('click', () => UI.busy(save, async () => {
      saveErr.show('');
      try {
        const r = await Api.patch('/api/me', { bio: bio.value, nameHue: hue });
        set(r.user); drawPreviews(); drawName();
        UI.toast('Profile saved!', 'good');
      } catch (e) { saveErr.show(e.message); }
    }));

    body.appendChild(section('Username colour', namePrev, slider, themeBtn));
    body.appendChild(section('Bio', bio, h('div', { class: 'edit-bio-foot' }, counter, save), saveErr));

    /* --- username --- */
    const uErr = UI.errorBox();
    const uInput = h('input', { type: 'text', maxlength: 20, value: me.username, spellcheck: 'false' });
    const uBtn = h('button', { class: 'acct-btn primary' }, 'Change');
    const uNote = h('p', { class: 'acct-hint' });
    const drawUNote = () => {
      const at = Account.user.usernameChangeAt;
      uNote.textContent = at
        ? 'You can change your username again on ' + new Date(at * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) + '. (Changing only capital letters is always allowed.)'
        : 'You can change your username once every 2 weeks. Your old name becomes free for anyone to take.';
    };
    drawUNote();
    uBtn.addEventListener('click', () => UI.busy(uBtn, async () => {
      uErr.show('');
      const v = uInput.value.trim();
      if (v === Account.user.username) return;
      if (v.toLowerCase() !== Account.user.username.toLowerCase() &&
          !confirm('Change your username to "' + v + '"? You won\'t be able to change it again for 2 weeks.')) return;
      try {
        const r = await Api.post('/api/me/username', { username: v });
        set(r.user); drawUNote(); drawName();
        UI.toast('You are now ' + r.user.username + '!', 'good');
      } catch (e) { uErr.show(e.message); }
    }));
    body.appendChild(section('Username', h('div', { class: 'edit-inline' }, uInput, uBtn), uNote, uErr));

    /* --- privacy --- */
    const toggle = (key, label, hint) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = !!Account.user.settings[key];
      box.addEventListener('change', async () => {
        box.disabled = true;
        try {
          const r = await Api.patch('/api/me', { [key]: box.checked });
          set(r.user);
          if (window.Presence) Presence.beat(true);
        } catch (e) { box.checked = !box.checked; UI.toast(e.message, 'bad'); }
        box.disabled = false;
      });
      return h('label', { class: 'edit-toggle' }, h('span', null, h('strong', null, label), h('small', null, hint)), box);
    };
    body.appendChild(section('Privacy',
      toggle('showActivity', 'Show my activity', 'Your most played games on your profile'),
      toggle('showGame', 'Show what I\'m playing', 'Shows the game you\'re in, and off-site games you just went to'),
      toggle('showFavorites', 'Show my favorite games', 'The games you starred, on your profile'),
      toggle('showMusic', 'Show what I\'m listening to', '"Listening to …" on your profile and status'),
      toggle('appearOffline', 'Always appear offline', 'Nobody will see you as active or away'),
      blockedList()));

    /* --- password --- */
    const pErr = UI.errorBox();
    const cur = h('input', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password', maxlength: 128 });
    const nw = h('input', { type: 'password', placeholder: 'New password (8+ characters)', autocomplete: 'new-password', maxlength: 128 });
    const nw2 = h('input', { type: 'password', placeholder: 'New password again', autocomplete: 'new-password', maxlength: 128 });
    const pBtn = h('button', { class: 'acct-btn primary' }, 'Change password');
    pBtn.addEventListener('click', () => UI.busy(pBtn, async () => {
      pErr.show('');
      if (nw.value !== nw2.value) return pErr.show("New passwords don't match.");
      try {
        await Api.post('/api/me/password', { current: cur.value, next: nw.value });
        cur.value = nw.value = nw2.value = '';
        UI.toast('Password changed. Other devices were logged out.', 'good');
      } catch (e) { pErr.show(e.message); }
    }));
    body.appendChild(section('Password',
      h('p', { class: 'acct-hint' }, 'Remember: forgotten passwords can\'t be recovered.'),
      cur, nw, nw2, pErr, pBtn));

    /* --- delete --- */
    const dBtn = h('button', { class: 'acct-btn danger' }, 'Delete my account');
    dBtn.addEventListener('click', () => deleteAccount(m));
    body.appendChild(section('Danger zone',
      h('p', { class: 'acct-hint' }, 'Deletes your profile, friends, messages you sent and your uploaded images. This can\'t be undone.'),
      dBtn));
  }

  function blockedList() {
    const wrap = h('div', { class: 'edit-blocked' }, h('h4', null, 'Blocked users'));
    const list = h('div', null, h('p', { class: 'acct-hint' }, 'Loading…'));
    wrap.appendChild(list);
    Api.get('/api/blocks').then(r => {
      list.innerHTML = '';
      if (!r.blocked.length) { list.appendChild(h('p', { class: 'acct-hint' }, 'Nobody. Nice!')); return; }
      r.blocked.forEach(b => {
        const row = h('div', { class: 'edit-blocked-row' }, h('span', null, b.username));
        const un = h('button', { class: 'acct-btn small' }, 'Unblock');
        un.addEventListener('click', () => UI.busy(un, async () => {
          await Api.del('/api/blocks/' + b.id); row.remove();
        }));
        row.appendChild(un);
        list.appendChild(row);
      });
    }).catch(e => { list.innerHTML = ''; list.appendChild(h('p', { class: 'acct-hint' }, e.message)); });
    return wrap;
  }

  function deleteAccount(editModal) {
    const err = UI.errorBox();
    const pw = h('input', { type: 'password', placeholder: 'Your password', autocomplete: 'current-password' });
    const confirmBox = h('input', { type: 'text', placeholder: 'Type DELETE' });
    const btn = h('button', { class: 'acct-btn danger wide' }, 'Delete forever');
    const body = h('div', { class: 'acct-form' },
      h('p', null, 'This permanently deletes ', h('strong', null, Account.user.username), ', your friends list, messages you sent and your uploaded pictures.'),
      pw, confirmBox, err, btn);
    const m = UI.modal({ title: 'Delete account?', body });
    btn.addEventListener('click', () => UI.busy(btn, async () => {
      err.show('');
      if (confirmBox.value.trim() !== 'DELETE') return err.show('Type DELETE to confirm.');
      try {
        await Api.del('/api/me', { password: pw.value });
        Api.setToken('');
        Account.setUser(null);
        m.close(); editModal.close();
        UI.toast('Your account was deleted. Bye!', 'good');
      } catch (e) { err.show(e.message); }
    }));
  }

  window.Profile = { view, edit, report };
})();
