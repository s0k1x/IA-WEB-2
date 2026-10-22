/* NEXUS AI · cliente de la Edge Function "nexus" de Supabase.
   Sin Supabase configurado no se simula ninguna respuesta. */
(function () {
  'use strict';
  const N = (globalThis.Nexus = globalThis.Nexus || {});
  const KEY = 'nexus.config';

  function loadConfig() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
  function saveConfig(cfg) { localStorage.setItem(KEY, JSON.stringify(cfg)); }
  function isConfigured() { const c = loadConfig(); return Boolean(c.baseUrl && c.token); }
  function normalizeUrl(u) { return String(u || '').trim().replace(/\/+$/, '').replace(/\/functions\/v1.*$/, ''); }

  async function call(path, { method = 'GET', body } = {}) {
    const c = loadConfig();
    if (!c.baseUrl || !c.token) throw new Error('Supabase no configurado');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(c.baseUrl + '/functions/v1/nexus' + path, {
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

  N.api = {
    loadConfig, saveConfig, isConfigured, normalizeUrl,
    health: () => call('/health'),
    createTask: (payload) => call('/tasks', { method: 'POST', body: payload }),
    answerTask: (id, text) => call(`/tasks/${encodeURIComponent(id)}/answer`, { method: 'POST', body: { text } }),
    cancelTask: (id) => call(`/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    authorize: (id, approve) => call(`/tasks/${encodeURIComponent(id)}/authorize`, { method: 'POST', body: { approve } }),
    events: (id, since) => call(`/tasks/${encodeURIComponent(id)}/events?since=${since}`),
    activeTasks: () => call('/tasks?active=1'),
    mcpInspect: (url) => call('/mcp/inspect', { method: 'POST', body: { url } }),
  };
})();
