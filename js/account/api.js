/* Talks to the Cloudflare Worker. window.Api */
(function () {
  const cfg = window.BOINGA_CONFIG || {};
  const BASE = String(cfg.API_BASE || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'boinga.session';

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  async function request(method, path, body, opts) {
    opts = opts || {};
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload;
    if (body instanceof Blob) {
      payload = body;
      headers['Content-Type'] = body.type || 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(BASE + path, { method, headers, body: payload, keepalive: !!opts.keepalive });
    } catch (e) {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    }
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401 && token && !opts.noLogout) {
        setToken('');
        document.dispatchEvent(new CustomEvent('boinga:loggedout', { detail: { expired: true } }));
      }
      const err = new Error(data.error || 'Something went wrong (' + res.status + ').');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.Api = {
    enabled: !!BASE,
    base: BASE,
    getToken: getToken,
    setToken: setToken,
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b, o) => request('POST', p, b === undefined ? {} : b, o),
    patch: (p, b) => request('PATCH', p, b),
    del: (p, b) => request('DELETE', p, b),
    // Data saver can hide uploaded pictures (falls back to the default Boinga pictures)
    mediaOn: true,
    media: key => (key && window.Api.mediaOn ? BASE + '/media/' + key.split('/').map(encodeURIComponent).join('/') : '')
  };
})();
