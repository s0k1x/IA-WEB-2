/* AURA-X · copia de seguridad local (nunca incluye claves ni tokens) */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const VERSION = 1;
  const SAFE_PREFS = ['tier', 'confirmDestructive', 'reviewAgents', 'webSearch', 'autonomous', 'budgetUsd', 'instructions', 'agentsAuto', 'agents', 'maxReviewRounds', 'theme'];

  function build({ conversations, projects, servers, prefs }) {
    const safe = {};
    for (const k of SAFE_PREFS) if (k in prefs) safe[k] = prefs[k];
    return {
      app: 'AURA-X', version: VERSION, exportedAt: new Date().toISOString(),
      conversations: conversations.raw(), projects: projects.raw(),
      mcp: servers.raw().map(({ name, url, enabled, tools }) => ({ name, url, enabled, tools })),
      prefs: safe,
    };
  }

  function parse(text) {
    let d;
    try { d = JSON.parse(text); } catch { return { ok: false, error: 'El archivo no es un JSON válido' }; }
    if (!d || typeof d !== 'object' || (d.app !== 'AURA-X' && d.app !== 'NEXUS AI')) return { ok: false, error: 'No parece una copia de seguridad de AURA-X' };
    if (d.version && d.version > VERSION) return { ok: false, error: 'La copia es de una versión más nueva' };
    const out = {
      conversations: Array.isArray(d.conversations) ? d.conversations : (d.conversation ? [{ id: 'imp_' + Date.now(), ...d.conversation }] : []),
      projects: Array.isArray(d.projects) ? d.projects : [],
      mcp: Array.isArray(d.mcp) ? d.mcp : [],
    };
    return { ok: true, data: out };
  }

  function restore(data, { conversations, projects, servers }) {
    return {
      projects: projects.importMany(data.projects),
      conversations: conversations.importMany(data.conversations),
      mcp: servers.importMany(data.mcp),
    };
  }

  A.backup = { build, parse, restore, VERSION };
})();
