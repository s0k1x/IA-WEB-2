/* AURA-X · cliente de la Edge Function de Supabase.
   Sin Supabase configurado no se simula ninguna respuesta. */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const KEY = 'aura.config';
  const DEFAULT_FN = 'aura';

  function loadConfig() { return A.storage.readJSON(localStorage, KEY, {}) || {}; }
  function saveConfig(cfg) { return A.storage.writeJSON(localStorage, KEY, cfg); }
  function isConfigured() { const c = loadConfig(); return Boolean(c.baseUrl && c.token); }
  function normalizeUrl(u) { return String(u || '').trim().replace(/\/+$/, '').replace(/\/functions\/v1.*$/, ''); }
  function normalizeFn(f) { return String(f || '').trim().replace(/[^\w-]/g, '') || DEFAULT_FN; }

  function validateBaseUrl(u) {
    let x; try { x = new URL(u); } catch { return 'La URL del proyecto no es válida'; }
    const local = ['localhost', '127.0.0.1'].includes(x.hostname);
    if (x.protocol !== 'https:' && !(local && x.protocol === 'http:')) return 'La URL debe empezar por https://';
    return null;
  }

  // Rechaza claves secretas: en el navegador solo puede ir la clave pública (anon / publishable).
  function checkKey(key) {
    const k = String(key || '').trim();
    if (!k) return 'Falta la clave anon (pública)';
    if (/^sb_secret_/i.test(k)) return 'Esa es una clave SECRETA de Supabase. Nunca la pongas aquí: usa la clave pública (anon / publishable).';
    const parts = k.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload && payload.role === 'service_role') return 'Esa es la clave service_role: es SECRETA y da acceso total. Usa la clave anon (pública).';
      } catch { /* no es un JWT legible: se acepta */ }
    }
    return null;
  }

  async function call(path, { method = 'GET', body } = {}) {
    const c = loadConfig();
    if (!c.baseUrl || !c.token) throw new Error('Supabase no configurado');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(c.baseUrl + '/functions/v1/' + normalizeFn(c.fn) + path, {
        method, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', apikey: c.token, Authorization: 'Bearer ' + c.token },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.status === 204 ? null : res.json();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message);
    } finally { clearTimeout(timer); }
  }

  const id = encodeURIComponent;
  A.api = {
    loadConfig, saveConfig, isConfigured, normalizeUrl, normalizeFn, validateBaseUrl, checkKey, DEFAULT_FN,
    health: () => call('/health'),
    async ping() { const t0 = performance.now(); await call('/health'); return Math.round(performance.now() - t0); },
    createTask: (payload) => call('/tasks', { method: 'POST', body: payload }),
    answerTask: (taskId, text) => call(`/tasks/${id(taskId)}/answer`, { method: 'POST', body: { text } }),
    cancelTask: (taskId) => call(`/tasks/${id(taskId)}/cancel`, { method: 'POST' }),
    authorize: (taskId, approve) => call(`/tasks/${id(taskId)}/authorize`, { method: 'POST', body: { approve } }),
    events: (taskId, since) => call(`/tasks/${id(taskId)}/events?since=${since}`),
    activeTasks: () => call('/tasks?active=1'),
    mcpInspect: (url) => call('/mcp/inspect', { method: 'POST', body: { url } }),
  };
})();
