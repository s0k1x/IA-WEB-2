/* AURA-X · conexión con Supabase: sesión, base de datos, archivos y la función "aura" */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const CFG = 'aura.server.v1', SES = 'aura.session.v1';
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* nada */ } };

  const normalizeUrl = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\/(rest|auth|functions)\/v1.*$/, '');
  const normalizeFn = (f) => String(f || '').trim().replace(/[^\w-]/g, '') || 'aura';
  function validateUrl(u) {
    let x; try { x = new URL(u); } catch { return 'La URL del proyecto no es válida'; }
    if (x.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(x.hostname)) return 'La URL debe empezar por https://';
    return null;
  }
  function checkKey(key) {
    const k = String(key || '').trim();
    if (!k) return 'Falta la clave pública (publishable o anon)';
    if (/^sb_secret_/i.test(k)) return 'Esa es una clave SECRETA. En la web solo va la clave pública (publishable o anon).';
    const parts = k.split('.');
    if (parts.length === 3) {
      try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p && p.role === 'service_role') return 'Esa es la clave service_role: es SECRETA. Usa la clave anon o publishable.'; } catch { /* no es JWT legible */ }
    }
    return null;
  }

  let cfg = read(CFG); let session = read(SES); let refreshing = null;
  const pre = globalThis.AURA_CONFIG;
  if (pre && pre.url && pre.key && !checkKey(pre.key) && !validateUrl(normalizeUrl(pre.url))) {
    const fixed = { url: normalizeUrl(pre.url), key: String(pre.key).trim(), fn: normalizeFn(pre.fn) };
    if (!cfg || cfg.url !== fixed.url || cfg.key !== fixed.key || cfg.fn !== fixed.fn) { cfg = fixed; write(CFG, cfg); }
  }
  const listeners = new Set();
  const setSession = (s) => { session = s; write(SES, s); listeners.forEach((fn) => fn(s)); };

  function keyHeaders() {
    const k = cfg.key; const hdr = { apikey: k };
    return hdr;
  }
  function authHeaders() { return { ...keyHeaders(), Authorization: `Bearer ${session ? session.access_token : cfg.key}` }; }

  async function parse(res) {
    const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = (body && (body.error_description || body.msg || body.message || body.error)) || `Error ${res.status}`;
      const e = new Error(translate(String(msg))); e.status = res.status; e.code = body && body.error_code; throw e;
    }
    return body;
  }
  function translate(m) {
    const map = [[/Invalid login credentials/i, 'Correo o contraseña incorrectos'], [/User already registered/i, 'Ya existe una cuenta con ese correo'],
      [/Password should be at least (\d+)/i, 'La contraseña debe tener al menos $1 caracteres'], [/Email not confirmed/i, 'Confirma tu correo antes de entrar'],
      [/rate limit/i, 'Demasiados intentos. Espera un momento.'], [/Invalid API key/i, 'La clave de Supabase no es válida'], [/Failed to fetch|NetworkError|Load failed/i, 'No hay conexión con Supabase']];
    for (const [re, t] of map) if (re.test(m)) return m.replace(re, t);
    return m;
  }
  async function request(url, init, retry = true) {
    let res;
    try { res = await fetch(url, init); } catch { throw new Error('No hay conexión con Supabase. Revisa tu internet o la URL del proyecto.'); }
    if (res.status === 401 && retry && session && session.refresh_token) {
      await refresh();
      return request(url, { ...init, headers: { ...init.headers, ...authHeaders() } }, false);
    }
    return parse(res);
  }

  async function auth(path, body, method = 'POST') {
    return request(`${cfg.url}/auth/v1/${path}`, { method, headers: { ...keyHeaders(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, false);
  }
  const toSession = (d) => d && d.access_token ? { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: d.user ? { id: d.user.id, email: d.user.email } : null } : null;
  async function signIn(email, password) { const s = toSession(await auth('token?grant_type=password', { email, password })); setSession(s); return s; }
  async function signUp(email, password) {
    const d = await auth('signup', { email, password, options: {} });
    const s = toSession(d); if (s) setSession(s);
    return { session: s, needsConfirmation: !s };
  }
  async function recover(email) { await auth('recover', { email }); }
  async function refresh() {
    if (!session) throw new Error('Sin sesión');
    if (!refreshing) refreshing = auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then((d) => setSession({ ...toSession(d), user: (d.user && { id: d.user.id, email: d.user.email }) || session.user }))
      .catch((e) => { setSession(null); throw new Error('Tu sesión ha caducado. Vuelve a entrar.'); })
      .finally(() => { refreshing = null; });
    return refreshing;
  }
  async function ensureFresh() { if (session && session.expires_at * 1000 - Date.now() < 60000) await refresh(); }
  async function signOut() {
    try { if (session) await fetch(`${cfg.url}/auth/v1/logout`, { method: 'POST', headers: authHeaders() }); } catch { /* nada */ }
    setSession(null);
  }
  function oauthUrl(provider) { return `${cfg.url}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(location.href.split('#')[0])}`; }
  async function fromRedirect() {
    if (!location.hash.includes('access_token=')) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    const s = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600), user: null };
    session = s;
    try { const u = await request(`${cfg.url}/auth/v1/user`, { headers: authHeaders() }, false); s.user = { id: u.id, email: u.email }; setSession(s); return true; }
    catch { setSession(null); return false; }
  }

  async function rest(path, { method = 'GET', body, prefer } = {}) {
    await ensureFresh();
    const headers = { ...authHeaders(), 'Content-Type': 'application/json' }; if (prefer) headers.Prefer = prefer;
    return request(`${cfg.url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function fn(path, { method = 'POST', body } = {}) {
    await ensureFresh();
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
    try {
      return await request(`${cfg.url}/functions/v1/${cfg.fn}${path}`, { method, signal: ctrl.signal, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('La función tardó demasiado en responder');
      if (e.status === 404 && /Requested function was not found|NOT_FOUND/i.test(e.message)) throw new Error(`No se encuentra la función «${cfg.fn}» en Supabase. ¿La has desplegado?`);
      throw e;
    } finally { clearTimeout(t); }
  }
  async function file(path) {
    await ensureFresh();
    const enc = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${cfg.url}/storage/v1/object/authenticated/attachments/${enc}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('No se pudo abrir el archivo');
    return res.blob();
  }

  A.supa = {
    preconfigured: Boolean(pre && pre.url && pre.key),
    normalizeUrl, normalizeFn, validateUrl, checkKey,
    get config() { return cfg; }, setConfig(c) { cfg = c; write(CFG, c); },
    get session() { return session; }, get user() { return session && session.user; },
    onSession(fn2) { listeners.add(fn2); }, signIn, signUp, signOut, recover, refresh, oauthUrl, fromRedirect,
    rest, fn, file,
  };
})();
