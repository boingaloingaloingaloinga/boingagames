/* =====================================================================
   BoingaGames accounts API — Cloudflare Worker
   Bindings (see wrangler.toml):
     DB     D1 database   (schema.sql)
     MEDIA  R2 bucket     (avatars/, banners/, chat/)
   Vars:
     ALLOWED_ORIGINS    comma list of site origins allowed to call the API
     ATTACHMENT_DAYS    chat images/gifs older than this are deleted by the daily cron
     PBKDF2_ITERATIONS  password hash cost (10000–100000; see wrangler.toml)
   ===================================================================== */

const TOS_VERSION = '2026-11-06';
const SESSION_DAYS = 60;
const USERNAME_COOLDOWN_DAYS = 14;
const ONLINE_WINDOW = 100;          // seconds without a heartbeat before someone shows offline
const EXTERNAL_WINDOW = 15 * 60;    // how long "just went to <game>" stays visible
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const RESERVED = new Set(['admin', 'administrator', 'boinga', 'boingagames', 'moderator', 'mod',
  'staff', 'support', 'system', 'official', 'owner', 'root', 'null', 'undefined', 'deleted']);

const IMAGE_RULES = {
  avatar: { prefix: 'avatars', maxBytes: 4 * 1024 * 1024, minW: 128, minH: 128 },
  banner: { prefix: 'banners', maxBytes: 6 * 1024 * 1024, minW: 600, minH: 150 },
  chat:   { prefix: 'chat',    maxBytes: 8 * 1024 * 1024, minW: 1,   minH: 1 }
};

/* ---------------------------------------------------------------- utils */

const now = () => Math.floor(Date.now() / 1000);
const enc = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

async function sha256hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Strip control characters (keeps newlines where allowed) and trim.
function cleanText(value, max, allowNewlines) {
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC');
  s = allowNewlines
    ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/g, '')
    : s.replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, '');
  if (allowNewlines) s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim().slice(0, max);
}

/* ------------------------------------------------------------- passwords */

async function hashPassword(password, iterations) {
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(bits)}`;
}

async function verifyPassword(password, stored) {
  const [alg, iter, saltS, hashS] = stored.split('$');
  if (alg !== 'pbkdf2') return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(saltS), iterations: Number(iter) }, key, 256));
  return timingSafeEqual(bits, fromB64url(hashS));
}

const iterations = env => Math.min(100000, Math.max(10000, Number(env.PBKDF2_ITERATIONS) || 40000));

// A fixed hash so logins for unknown usernames take the same time as real ones.
let dummyHash = null;

/* ------------------------------------------------------------ rate limit */

async function rateLimit(env, key, limit, windowSec) {
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count    = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
     RETURNING count`
  ).bind(key, t + windowSec, t).first();
  if (row.count > limit) fail(429, 'Slow down a little and try again in a bit.');
}

/* --------------------------------------------------------------- images */

// Reads width/height from PNG, GIF, JPEG and WebP headers. Returns null for anything else.
function imageInfo(buf) {
  const b = new Uint8Array(buf);
  const u16be = i => (b[i] << 8) | b[i + 1];
  const u16le = i => b[i] | (b[i + 1] << 8);
  const u24le = i => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  if (b.length < 30) return null;

  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47)
    return { type: 'image/png', ext: 'png', w: u32be(16), h: u32be(20) };

  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
    return { type: 'image/gif', ext: 'gif', w: u16le(6), h: u16le(8) };

  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i += (m === 0xFF ? 1 : 2); continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
        return { type: 'image/jpeg', ext: 'jpg', w: u16be(i + 7), h: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
    return null;
  }

  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X') return { type: 'image/webp', ext: 'webp', w: u24le(24) + 1, h: u24le(27) + 1 };
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: 'image/webp', ext: 'webp', w: (bits & 0x3FFF) + 1, h: ((bits >> 14) & 0x3FFF) + 1 };
    }
    if (chunk === 'VP8 ') return { type: 'image/webp', ext: 'webp', w: u16le(26) & 0x3FFF, h: u16le(28) & 0x3FFF };
  }
  return null;
}

async function readImageUpload(request, kind, env) {
  const base = IMAGE_RULES[kind];
  const rule = env.MEDIA ? base : Object.assign({}, base, { maxBytes: Math.min(base.maxBytes, D1_MEDIA_MAX) });
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > rule.maxBytes) fail(413, `That file is too big (max ${+(rule.maxBytes / 1048576).toFixed(1)} MB).`);
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) fail(400, 'No file received.');
  if (buf.byteLength > rule.maxBytes) fail(413, `That file is too big (max ${+(rule.maxBytes / 1048576).toFixed(1)} MB).`);
  const info = imageInfo(buf);
  if (!info) fail(415, 'Only PNG, JPG, GIF or WebP images are allowed.');
  if (info.w < rule.minW || info.h < rule.minH)
    fail(422, `Image must be at least ${rule.minW}×${rule.minH} pixels (yours is ${info.w}×${info.h}).`);
  return { buf, info };
}

/* ----------------------------------------------------- media storage */

// Images live in R2 when the MEDIA bucket is bound. Without it (R2 needs a payment
// method on file to enable) they're stored in D1 instead, capped just under D1's 2 MB row limit.
const D1_MEDIA_MAX = 1900000;

function d1Media(env) {
  return {
    async put(key, buf, opts) {
      const cm = (opts && opts.customMetadata) || {};
      await env.DB.prepare('INSERT OR REPLACE INTO media (key, data, type, w, h, uploaded) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(key, buf, opts.httpMetadata.contentType, Number(cm.w) || null, Number(cm.h) || null, now()).run();
    },
    async get(key) {
      const row = await env.DB.prepare('SELECT data, type FROM media WHERE key = ?1').bind(key).first();
      if (!row) return null;
      return { body: new Uint8Array(row.data), writeHttpMetadata(h) { h.set('Content-Type', row.type); } };
    },
    async head(key) {
      const row = await env.DB.prepare('SELECT w, h FROM media WHERE key = ?1').bind(key).first();
      return row ? { customMetadata: { w: String(row.w || ''), h: String(row.h || '') } } : null;
    },
    async delete(keys) {
      const list = [].concat(keys);
      if (list.length) await env.DB.batch(list.map(k => env.DB.prepare('DELETE FROM media WHERE key = ?1').bind(k)));
    }
  };
}
const media = env => env.MEDIA || d1Media(env);

/* ------------------------------------------------------------- sessions */

async function createSession(env, userId) {
  const token = b64url(randomBytes(32));
  const t = now();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used) VALUES (?1, ?2, ?3, ?4, ?3)'
  ).bind(await sha256hex(token), userId, t, t + SESSION_DAYS * 86400).run();
  return token;
}

async function getAuth(request, env, required = true) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) { if (required) fail(401, 'Please log in.'); return null; }
  const hash = await sha256hex(token);
  const t = now();
  const row = await env.DB.prepare(
    `SELECT u.*, s.last_used AS s_last_used, s.token_hash AS s_hash FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2`
  ).bind(hash, t).first();
  if (!row) { if (required) fail(401, 'Your session expired. Please log in again.'); return null; }
  if (row.banned) fail(403, 'This account has been suspended.');
  // Sliding expiry, written at most once a day to save writes.
  if (t - row.s_last_used > 86400) {
    await env.DB.prepare('UPDATE sessions SET last_used = ?1, expires_at = ?2 WHERE token_hash = ?3')
      .bind(t, t + SESSION_DAYS * 86400, hash).run();
  }
  return row;
}

/* ------------------------------------------------------------- shaping */

function statusOf(user, presence, t = now()) {
  if (!presence || user.appear_offline || t - presence.last_seen > ONLINE_WINDOW) return 'offline';
  return presence.state === 'away' ? 'away' : 'active';
}

function publicUser(u, p, viewerIsSelf = false) {
  const t = now();
  const status = statusOf(u, p, t);
  const out = {
    id: u.id,
    username: u.username,
    nameHue: u.name_hue,
    avatarHue: u.avatar_hue,
    avatar: u.avatar_key,
    banner: u.banner_key,
    bio: u.bio,
    createdAt: u.created_at,
    status,
    game: null,
    external: null,
    activity: null
  };
  if ((u.show_game || viewerIsSelf) && status !== 'offline' && p) {
    if (p.game_id) out.game = { id: p.game_id, name: p.game_name };
  }
  if ((u.show_game || viewerIsSelf) && !u.appear_offline && p && p.ext_id && t - p.ext_at < EXTERNAL_WINDOW) {
    out.external = { id: p.ext_id, name: p.ext_name, at: p.ext_at };
  }
  if (u.show_activity || viewerIsSelf) {
    try { out.activity = JSON.parse(u.activity_json || '[]'); } catch { out.activity = []; }
  }
  return out;
}

function selfUser(u, p) {
  const out = publicUser(u, p, true);
  const nextChange = u.username_changed_at ? u.username_changed_at + USERNAME_COOLDOWN_DAYS * 86400 : 0;
  return Object.assign(out, {
    settings: {
      showActivity: !!u.show_activity,
      showGame: !!u.show_game,
      appearOffline: !!u.appear_offline
    },
    usernameChangeAt: nextChange > now() ? nextChange : 0
  });
}

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

async function relationship(env, me, other) {
  if (me === other) return 'self';
  const [lo, hi] = pair(me, other);
  const r = await env.DB.prepare(
    `SELECT
       (SELECT 1 FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2) AS i_blocked,
       (SELECT 1 FROM blocks WHERE blocker_id = ?2 AND blocked_id = ?1) AS they_blocked,
       (SELECT 1 FROM friendships WHERE user_lo = ?3 AND user_hi = ?4) AS friends,
       (SELECT 1 FROM friend_requests WHERE from_id = ?1 AND to_id = ?2) AS outgoing,
       (SELECT 1 FROM friend_requests WHERE from_id = ?2 AND to_id = ?1) AS incoming`
  ).bind(me, other, lo, hi).first();
  if (r.i_blocked) return 'blocked';
  if (r.they_blocked) return 'blocked_by';
  if (r.friends) return 'friends';
  if (r.outgoing) return 'outgoing';
  if (r.incoming) return 'incoming';
  return 'none';
}

async function userByName(env, name) {
  return env.DB.prepare('SELECT * FROM users WHERE username_lower = ?1 AND banned = 0')
    .bind(String(name || '').toLowerCase()).first();
}

async function presenceOf(env, id) {
  return env.DB.prepare('SELECT * FROM presence WHERE user_id = ?1').bind(id).first();
}

async function deleteMedia(env, key) {
  if (key) { try { await media(env).delete(key); } catch (e) { /* already gone */ } }
}

/* ============================================================== ROUTES */

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

/* ---------- auth ---------- */

route('POST', '/api/auth/signup', async (req, env, ctx) => {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';

  if (!body.agree) fail(400, 'You need to agree to the Terms of Service and Privacy Policy.');
  if (!body.age13) fail(400, 'You must be 13 or older to make an account.');
  if (!USERNAME_RE.test(username)) fail(400, 'Usernames are 3–20 characters: letters, numbers and _ only.');
  if (RESERVED.has(username.toLowerCase())) fail(409, 'That username is taken.');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters.');
  if (password.length > 128) fail(400, 'Password is too long (max 128).');
  if (password.toLowerCase() === username.toLowerCase()) fail(400, "Your password can't be your username.");

  await rateLimit(env, 'signup:' + ip, 5, 3600);

  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE username_lower = ?1').bind(username.toLowerCase()).first();
  if (taken) fail(409, 'That username is taken.');

  const hash = await hashPassword(password, iterations(env));
  const hue = Math.floor(Math.random() * 360);
  let user;
  try {
    user = await env.DB.prepare(
      `INSERT INTO users (username, username_lower, pass_hash, created_at, avatar_hue, tos_version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`
    ).bind(username, username.toLowerCase(), hash, now(), hue, TOS_VERSION).first();
  } catch (e) {
    fail(409, 'That username is taken.');
  }
  const token = await createSession(env, user.id);
  return { token, user: selfUser(user, null) };
});

route('GET', '/api/auth/available', async (req, env) => {
  const name = String(new URL(req.url).searchParams.get('username') || '').trim();
  if (!USERNAME_RE.test(name)) return { available: false, reason: 'Usernames are 3–20 characters: letters, numbers and _ only.' };
  if (RESERVED.has(name.toLowerCase())) return { available: false, reason: 'That username is taken.' };
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE username_lower = ?1').bind(name.toLowerCase()).first();
  return taken ? { available: false, reason: 'That username is taken.' } : { available: true };
});

route('POST', '/api/auth/login', async (req, env) => {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!username || !password || password.length > 128) fail(400, 'Enter your username and password.');

  await rateLimit(env, 'login-ip:' + ip, 30, 900);
  await rateLimit(env, 'login-user:' + username.toLowerCase(), 10, 900);

  const user = await env.DB.prepare('SELECT * FROM users WHERE username_lower = ?1').bind(username.toLowerCase()).first();
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password', iterations(env));
  const ok = await verifyPassword(password, user ? user.pass_hash : dummyHash);
  if (!user || !ok) fail(401, 'Wrong username or password.');
  if (user.banned) fail(403, 'This account has been suspended.');

  // If PBKDF2_ITERATIONS was raised since this password was saved, upgrade the hash now.
  const want = iterations(env);
  if (Number(user.pass_hash.split('$')[1]) < want) {
    await env.DB.prepare('UPDATE users SET pass_hash = ?1 WHERE id = ?2').bind(await hashPassword(password, want), user.id).run();
  }

  const token = await createSession(env, user.id);
  return { token, user: selfUser(user, await presenceOf(env, user.id)) };
});

route('POST', '/api/auth/logout', async (req, env) => {
  const me = await getAuth(req, env, false);
  if (me) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(me.s_hash).run();
  return { ok: true };
});

/* ---------- my account ---------- */

route('GET', '/api/me', async (req, env) => {
  const me = await getAuth(req, env);
  return { user: selfUser(me, await presenceOf(env, me.id)) };
});

route('PATCH', '/api/me', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  const sets = [], vals = [];
  const add = (col, v) => { sets.push(`${col} = ?${vals.length + 1}`); vals.push(v); };

  if ('bio' in b) add('bio', cleanText(b.bio, 300, true));
  if ('nameHue' in b) {
    const h = b.nameHue === null ? null : Math.round(Number(b.nameHue));
    if (h !== null && !(h >= 0 && h <= 359)) fail(400, 'Bad colour.');
    add('name_hue', h);
  }
  if ('showActivity' in b) add('show_activity', b.showActivity ? 1 : 0);
  if ('showGame' in b) add('show_game', b.showGame ? 1 : 0);
  if ('appearOffline' in b) add('appear_offline', b.appearOffline ? 1 : 0);
  if (!sets.length) fail(400, 'Nothing to update.');

  vals.push(me.id);
  const user = await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?${vals.length} RETURNING *`)
    .bind(...vals).first();
  return { user: selfUser(user, await presenceOf(env, me.id)) };
});

route('POST', '/api/me/username', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || '').trim();
  const t = now();
  if (me.username_changed_at && t - me.username_changed_at < USERNAME_COOLDOWN_DAYS * 86400)
    fail(429, 'You can only change your username once every 2 weeks.');
  if (!USERNAME_RE.test(username)) fail(400, 'Usernames are 3–20 characters: letters, numbers and _ only.');
  if (RESERVED.has(username.toLowerCase())) fail(409, 'That username is taken.');

  const sameName = username.toLowerCase() === me.username_lower;
  if (!sameName) {
    const taken = await env.DB.prepare('SELECT 1 FROM users WHERE username_lower = ?1').bind(username.toLowerCase()).first();
    if (taken) fail(409, 'That username is taken.');
  }
  let user;
  try {
    // Changing only the capitalisation doesn't use up the 2-week cooldown.
    user = await env.DB.prepare(
      `UPDATE users SET username = ?1, username_lower = ?2, username_changed_at = ?3 WHERE id = ?4 RETURNING *`
    ).bind(username, username.toLowerCase(), sameName ? me.username_changed_at : t, me.id).first();
  } catch (e) {
    fail(409, 'That username is taken.');
  }
  return { user: selfUser(user, await presenceOf(env, me.id)) };
});

route('POST', '/api/me/password', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  await rateLimit(env, 'pw:' + me.id, 10, 3600);
  if (!(await verifyPassword(String(b.current || ''), me.pass_hash))) fail(401, 'Current password is wrong.');
  const next = String(b.next || '');
  if (next.length < 8 || next.length > 128) fail(400, 'New password must be 8–128 characters.');
  const hash = await hashPassword(next, iterations(env));
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?1 WHERE id = ?2').bind(hash, me.id),
    // Log out every other device.
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2').bind(me.id, me.s_hash)
  ]);
  return { ok: true };
});

route('DELETE', '/api/me', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  await rateLimit(env, 'pw:' + me.id, 10, 3600);
  if (!(await verifyPassword(String(b.password || ''), me.pass_hash))) fail(401, 'Password is wrong.');

  const attachments = await env.DB.prepare(
    'SELECT attach_key FROM messages WHERE sender_id = ?1 AND attach_key IS NOT NULL AND attach_expired = 0'
  ).bind(me.id).all();
  const keys = [me.avatar_key, me.banner_key, ...attachments.results.map(r => r.attach_key)].filter(Boolean);
  for (let i = 0; i < keys.length; i += 500) { try { await media(env).delete(keys.slice(i, i + 500)); } catch (e) {} }

  const id = me.id;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM presence WHERE user_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM friendships WHERE user_lo = ?1 OR user_hi = ?1').bind(id),
    env.DB.prepare('DELETE FROM friend_requests WHERE from_id = ?1 OR to_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ?1 OR blocked_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM unread WHERE user_id = ?1 OR peer_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM messages WHERE sender_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(id)
  ]);
  return { ok: true };
});

async function setProfileImage(req, env, kind, column) {
  const me = await getAuth(req, env);
  await rateLimit(env, 'img:' + me.id, 20, 3600);
  const { buf, info } = await readImageUpload(req, kind, env);
  const key = `${IMAGE_RULES[kind].prefix}/${me.id}-${crypto.randomUUID()}.${info.ext}`;
  await media(env).put(key, buf, { httpMetadata: { contentType: info.type } });
  const user = await env.DB.prepare(`UPDATE users SET ${column} = ?1 WHERE id = ?2 RETURNING *`).bind(key, me.id).first();
  await deleteMedia(env, me[column]);
  return { user: selfUser(user, await presenceOf(env, me.id)) };
}
async function clearProfileImage(req, env, column) {
  const me = await getAuth(req, env);
  const user = await env.DB.prepare(`UPDATE users SET ${column} = NULL WHERE id = ?1 RETURNING *`).bind(me.id).first();
  await deleteMedia(env, me[column]);
  return { user: selfUser(user, await presenceOf(env, me.id)) };
}
route('POST', '/api/me/avatar', (req, env) => setProfileImage(req, env, 'avatar', 'avatar_key'));
route('DELETE', '/api/me/avatar', (req, env) => clearProfileImage(req, env, 'avatar_key'));
route('POST', '/api/me/banner', (req, env) => setProfileImage(req, env, 'banner', 'banner_key'));
route('DELETE', '/api/me/banner', (req, env) => clearProfileImage(req, env, 'banner_key'));

/* ---------- presence (heartbeat) ---------- */

route('POST', '/api/presence', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  // 'offline' is sent when the tab closes so you drop offline right away
  const t = b.state === 'offline' ? 0 : now();
  const state = b.state === 'away' ? 'away' : 'active';
  const game = b.game && b.game.id ? { id: cleanText(b.game.id, 60), name: cleanText(b.game.name, 80) } : null;
  const ext = b.external && b.external.id ? { id: cleanText(b.external.id, 60), name: cleanText(b.external.name, 80) } : null;

  const stmts = [
    env.DB.prepare(
      `INSERT INTO presence (user_id, last_seen, state, game_id, game_name, ext_id, ext_name, ext_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(user_id) DO UPDATE SET
         last_seen = ?2, state = ?3, game_id = ?4, game_name = ?5,
         ext_id   = COALESCE(?6, ext_id),
         ext_name = COALESCE(?7, ext_name),
         ext_at   = COALESCE(?8, ext_at)`
    ).bind(me.id, t, state, game && game.id, game && game.name,
           ext && ext.id, ext && ext.name, ext ? now() : null)
  ];

  // Top games from the site's local stats, only sent when they change.
  if (Array.isArray(b.activity)) {
    const activity = b.activity.slice(0, 5).map(a => ({
      id: cleanText(a.id, 60), name: cleanText(a.name, 80),
      time: Math.max(0, Math.min(1e9, Math.floor(Number(a.time) || 0)))
    })).filter(a => a.id);
    stmts.push(env.DB.prepare('UPDATE users SET activity_json = ?1 WHERE id = ?2').bind(JSON.stringify(activity), me.id));
  }
  await env.DB.batch(stmts);

  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM friend_requests WHERE to_id = ?1) AS requests,
            (SELECT COALESCE(SUM(count), 0) FROM unread WHERE user_id = ?1) AS unread`
  ).bind(me.id).first();
  const perFriend = await env.DB.prepare('SELECT peer_id, count FROM unread WHERE user_id = ?1 AND count > 0').bind(me.id).all();
  return {
    requests: counts.requests,
    unread: counts.unread,
    unreadBy: Object.fromEntries(perFriend.results.map(r => [r.peer_id, r.count]))
  };
});

/* ---------- users ---------- */

route('GET', '/api/users/search', async (req, env) => {
  const me = await getAuth(req, env);
  await rateLimit(env, 'search:' + me.id, 60, 60);
  const q = String(new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,20}$/.test(q)) return { users: [] };
  const rows = await env.DB.prepare(
    `SELECT u.*, p.last_seen, p.state, p.game_id, p.game_name, p.ext_id, p.ext_name, p.ext_at
     FROM users u LEFT JOIN presence p ON p.user_id = u.id
     WHERE u.username_lower >= ?1 AND u.username_lower < ?2 AND u.banned = 0 AND u.id != ?3
       AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = u.id AND blocked_id = ?3))
     ORDER BY u.username_lower LIMIT 20`
  ).bind(q, q + '￿', me.id).all();
  return { users: rows.results.map(r => publicUser(r, r.last_seen ? r : null)) };
});

route('GET', '/api/users/:name', async (req, env, ctx, params) => {
  const me = await getAuth(req, env);
  const u = await userByName(env, decodeURIComponent(params.name));
  if (!u) fail(404, 'User not found.');
  const rel = await relationship(env, me.id, u.id);
  if (rel === 'blocked_by') fail(404, 'User not found.');
  const p = await presenceOf(env, u.id);
  return { user: Object.assign(publicUser(u, p, u.id === me.id), { relationship: rel }) };
});

/* ---------- friends ---------- */

route('GET', '/api/friends', async (req, env) => {
  const me = await getAuth(req, env);
  const cols = 'u.*, p.last_seen, p.state, p.game_id, p.game_name, p.ext_id, p.ext_name, p.ext_at';
  const [friends, incoming, outgoing, unread] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${cols} FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_lo = ?1 THEN f.user_hi ELSE f.user_lo END
       LEFT JOIN presence p ON p.user_id = u.id
       WHERE (f.user_lo = ?1 OR f.user_hi = ?1) AND u.banned = 0`).bind(me.id),
    env.DB.prepare(
      `SELECT ${cols}, r.created_at AS req_at FROM friend_requests r JOIN users u ON u.id = r.from_id
       LEFT JOIN presence p ON p.user_id = u.id WHERE r.to_id = ?1 ORDER BY r.created_at DESC`).bind(me.id),
    env.DB.prepare(
      `SELECT ${cols}, r.created_at AS req_at FROM friend_requests r JOIN users u ON u.id = r.to_id
       LEFT JOIN presence p ON p.user_id = u.id WHERE r.from_id = ?1 ORDER BY r.created_at DESC`).bind(me.id),
    env.DB.prepare('SELECT peer_id, count FROM unread WHERE user_id = ?1 AND count > 0').bind(me.id)
  ]);
  const shape = r => publicUser(r, r.last_seen ? r : null);
  const unreadBy = Object.fromEntries(unread.results.map(r => [r.peer_id, r.count]));
  return {
    friends: friends.results.map(r => Object.assign(shape(r), { unread: unreadBy[r.id] || 0 })),
    incoming: incoming.results.map(shape),
    outgoing: outgoing.results.map(shape)
  };
});

route('POST', '/api/friends/request', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  await rateLimit(env, 'friendreq:' + me.id, 40, 3600);
  const other = await userByName(env, b.username);
  if (!other) fail(404, 'User not found.');
  const rel = await relationship(env, me.id, other.id);
  if (rel === 'self') fail(400, "You can't friend yourself (but we believe in you).");
  if (rel === 'blocked') fail(400, 'Unblock them first.');
  if (rel === 'blocked_by') fail(404, 'User not found.');
  if (rel === 'friends') return { relationship: 'friends' };
  if (rel === 'outgoing') return { relationship: 'outgoing' };
  if (rel === 'incoming') {
    // They already asked you — sending one back accepts it.
    const [lo, hi] = pair(me.id, other.id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM friend_requests WHERE from_id = ?1 AND to_id = ?2').bind(other.id, me.id),
      env.DB.prepare('INSERT OR IGNORE INTO friendships (user_lo, user_hi, created_at) VALUES (?1, ?2, ?3)').bind(lo, hi, now())
    ]);
    return { relationship: 'friends' };
  }
  await env.DB.prepare('INSERT OR IGNORE INTO friend_requests (from_id, to_id, created_at) VALUES (?1, ?2, ?3)')
    .bind(me.id, other.id, now()).run();
  return { relationship: 'outgoing' };
});

route('POST', '/api/friends/respond', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  const otherId = Number(b.userId);
  const exists = await env.DB.prepare('SELECT 1 FROM friend_requests WHERE from_id = ?1 AND to_id = ?2')
    .bind(otherId, me.id).first();
  if (!exists) fail(404, 'That friend request is gone.');
  const stmts = [env.DB.prepare('DELETE FROM friend_requests WHERE from_id = ?1 AND to_id = ?2').bind(otherId, me.id)];
  if (b.accept) {
    const [lo, hi] = pair(me.id, otherId);
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO friendships (user_lo, user_hi, created_at) VALUES (?1, ?2, ?3)').bind(lo, hi, now()));
  }
  await env.DB.batch(stmts);
  return { relationship: b.accept ? 'friends' : 'none' };
});

// Removes a friend, cancels your request, or declines theirs.
route('DELETE', '/api/friends/:id', async (req, env, ctx, params) => {
  const me = await getAuth(req, env);
  const otherId = Number(params.id);
  const [lo, hi] = pair(me.id, otherId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friendships WHERE user_lo = ?1 AND user_hi = ?2').bind(lo, hi),
    env.DB.prepare('DELETE FROM friend_requests WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)').bind(me.id, otherId),
    env.DB.prepare('DELETE FROM unread WHERE user_id = ?1 AND peer_id = ?2').bind(me.id, otherId)
  ]);
  return { relationship: 'none' };
});

/* ---------- blocks + reports ---------- */

route('GET', '/api/blocks', async (req, env) => {
  const me = await getAuth(req, env);
  const rows = await env.DB.prepare(
    'SELECT u.id, u.username FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?1 ORDER BY u.username_lower'
  ).bind(me.id).all();
  return { blocked: rows.results };
});

route('POST', '/api/blocks', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  const otherId = Number(b.userId);
  if (!otherId || otherId === me.id) fail(400, 'Bad user.');
  const [lo, hi] = pair(me.id, otherId);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?1, ?2, ?3)').bind(me.id, otherId, now()),
    env.DB.prepare('DELETE FROM friendships WHERE user_lo = ?1 AND user_hi = ?2').bind(lo, hi),
    env.DB.prepare('DELETE FROM friend_requests WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)').bind(me.id, otherId),
    env.DB.prepare('DELETE FROM unread WHERE user_id = ?1 AND peer_id = ?2').bind(me.id, otherId)
  ]);
  return { relationship: 'blocked' };
});

route('DELETE', '/api/blocks/:id', async (req, env, ctx, params) => {
  const me = await getAuth(req, env);
  await env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2').bind(me.id, Number(params.id)).run();
  return { relationship: 'none' };
});

route('POST', '/api/report', async (req, env) => {
  const me = await getAuth(req, env);
  const b = await req.json().catch(() => ({}));
  await rateLimit(env, 'report:' + me.id, 10, 3600);
  const reason = cleanText(b.reason, 500, true);
  if (!reason) fail(400, 'Tell us what happened.');
  await env.DB.prepare('INSERT INTO reports (reporter_id, target_id, message_id, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(me.id, Number(b.userId) || 0, Number(b.messageId) || null, reason, now()).run();
  return { ok: true };
});

/* ---------- messages ---------- */

async function requireFriend(env, me, otherId) {
  const [lo, hi] = pair(me, otherId);
  const f = await env.DB.prepare('SELECT 1 FROM friendships WHERE user_lo = ?1 AND user_hi = ?2').bind(lo, hi).first();
  if (!f) fail(403, 'You can only message friends.');
  return [lo, hi];
}

function shapeMessage(m) {
  return {
    id: m.id, from: m.sender_id, body: m.deleted ? '' : m.body, at: m.created_at, deleted: !!m.deleted,
    attachment: m.attach_key && !m.deleted
      ? (m.attach_expired ? { expired: true } : { key: m.attach_key, w: m.attach_w, h: m.attach_h })
      : null
  };
}

route('GET', '/api/messages/:id', async (req, env, ctx, params) => {
  const me = await getAuth(req, env);
  const otherId = Number(params.id);
  const [lo, hi] = await requireFriend(env, me.id, otherId);
  const sp = new URL(req.url).searchParams;
  const after = Number(sp.get('after') || 0);
  const before = Number(sp.get('before') || 0);
  let rows;
  if (after) {
    rows = await env.DB.prepare(
      'SELECT * FROM messages WHERE user_lo = ?1 AND user_hi = ?2 AND id > ?3 ORDER BY id ASC LIMIT 100'
    ).bind(lo, hi, after).all();
  } else {
    rows = await env.DB.prepare(
      `SELECT * FROM (SELECT * FROM messages WHERE user_lo = ?1 AND user_hi = ?2 AND id < ?3 ORDER BY id DESC LIMIT 50)
       ORDER BY id ASC`
    ).bind(lo, hi, before || Number.MAX_SAFE_INTEGER).all();
  }
  return { messages: rows.results.map(shapeMessage) };
});

route('POST', '/api/messages/:id/read', async (req, env, ctx, params) => {
  const me = await getAuth(req, env);
  await env.DB.prepare('UPDATE unread SET count = 0 WHERE user_id = ?1 AND peer_id = ?2 AND count > 0')
    .bind(me.id, Number(params.id)).run();
  return { ok: true };
});

route('POST', '/api/messages/:id', async (req, env, ctx, params) => {
  const me = await getAuth(req, env);
  const otherId = Number(params.id);
  const [lo, hi] = await requireFriend(env, me.id, otherId);
  await rateLimit(env, 'msg:' + me.id, 30, 60);
  const b = await req.json().catch(() => ({}));
  const body = cleanText(b.body, 1000, true);
  let attach = null;
  if (b.attachment) {
    const key = String(b.attachment);
    if (!/^chat\/\d+-[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(key) || !key.startsWith(`chat/${me.id}-`)) fail(400, 'Bad attachment.');
    const head = await media(env).head(key);
    if (!head) fail(400, 'That upload expired. Try attaching it again.');
    attach = { key, w: Number(head.customMetadata && head.customMetadata.w) || null, h: Number(head.customMetadata && head.customMetadata.h) || null };
  }
  if (!body && !attach) fail(400, 'Message is empty.');

  const [msg] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO messages (user_lo, user_hi, sender_id, body, attach_key, attach_w, attach_h, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING *`
    ).bind(lo, hi, me.id, body, attach && attach.key, attach && attach.w, attach && attach.h, now()),
    env.DB.prepare(
      `INSERT INTO unread (user_id, peer_id, count) VALUES (?1, ?2, 1)
       ON CONFLICT(user_id, peer_id) DO UPDATE SET count = count + 1`
    ).bind(otherId, me.id)
  ]);
  return { message: shapeMessage(msg.results[0]) };
});

route('DELETE', '/api/messages/item/:id', async (req, env, ctx, params) => {
  const me = await getAuth(req, env);
  const m = await env.DB.prepare('SELECT * FROM messages WHERE id = ?1 AND sender_id = ?2').bind(Number(params.id), me.id).first();
  if (!m) fail(404, 'Message not found.');
  if (m.attach_key && !m.attach_expired) await deleteMedia(env, m.attach_key);
  await env.DB.prepare("UPDATE messages SET deleted = 1, body = '' WHERE id = ?1").bind(m.id).run();
  return { ok: true };
});

route('POST', '/api/upload/chat', async (req, env) => {
  const me = await getAuth(req, env);
  await rateLimit(env, 'upload:' + me.id, 30, 3600);
  const { buf, info } = await readImageUpload(req, 'chat', env);
  const key = `chat/${me.id}-${crypto.randomUUID()}.${info.ext}`;
  await media(env).put(key, buf, {
    httpMetadata: { contentType: info.type },
    customMetadata: { w: String(info.w), h: String(info.h) }
  });
  return { key, w: info.w, h: info.h };
});

/* ---------- media ---------- */

async function serveMedia(req, env, key) {
  if (!/^(avatars|banners|chat)\/[\w.-]+$/.test(key)) fail(404, 'Not found.');
  const obj = await media(env).get(key);
  if (!obj) fail(404, 'This image has expired.');
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(obj.body, { headers });
}

/* ============================================================ DISPATCH */

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (allowed.includes('*') ? '*' : origin) : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const cors = corsHeaders(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      return await serveMedia(req, env, decodeURIComponent(url.pathname.slice(7)));
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      const result = await r.handler(req, env, ctx, params);
      return new Response(JSON.stringify(result), {
        headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors)
      });
    }
    if (url.pathname === '/' || url.pathname === '/api') {
      return new Response('BoingaGames accounts API is running.', { headers: cors });
    }
    fail(404, 'Not found.');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e && e.stack || e);
    return new Response(JSON.stringify({ error: status === 500 ? 'Something went wrong on our end.' : e.message }), {
      status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
    });
  }
}

/* ============================================================== CLEANUP */

async function cleanup(env) {
  const t = now();
  const days = Number(env.ATTACHMENT_DAYS || 30);
  const cutoff = t - days * 86400;

  // 1. Chat images/gifs past their lifetime (also catches uploads that were never sent).
  if (!env.MEDIA) {
    await env.DB.prepare("DELETE FROM media WHERE key LIKE 'chat/%' AND uploaded < ?1").bind(cutoff).run();
  }
  let cursor;
  while (env.MEDIA) {
    const list = await env.MEDIA.list({ prefix: 'chat/', cursor, limit: 1000 });
    const old = list.objects.filter(o => o.uploaded.getTime() / 1000 < cutoff).map(o => o.key);
    if (old.length) await env.MEDIA.delete(old);
    cursor = list.truncated ? list.cursor : undefined;
    if (!cursor) break;
  }
  await env.DB.prepare(
    'UPDATE messages SET attach_expired = 1 WHERE attach_key IS NOT NULL AND attach_expired = 0 AND created_at < ?1'
  ).bind(cutoff).run();

  // 2. Expired sessions, stale rate-limit rows, long-gone presence.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(t),
    env.DB.prepare('DELETE FROM rate_limits WHERE reset_at < ?1').bind(t)
  ]);
}

export default {
  fetch: handle,
  scheduled: (event, env, ctx) => ctx.waitUntil(cleanup(env)),
  // exported for tests
  _internal: { imageInfo, cleanup }
};
