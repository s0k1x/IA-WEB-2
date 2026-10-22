/* AURA-X · almacenamiento local seguro y migración desde la versión NEXUS */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const MIGRATE = [
    ['nexus.config', 'aura.config'], ['nexus.convs.v1', 'aura.convs.v1'],
    ['nexus.mcp.v1', 'aura.mcp.v1'], ['nexus.prefs.v1', 'aura.prefs.v1'],
  ];
  const KEYS = ['aura.config', 'aura.convs.v1', 'aura.projects.v1', 'aura.mcp.v1', 'aura.prefs.v1'];

  function migrate(storage) {
    let moved = 0;
    for (const [o, n] of MIGRATE) {
      try {
        if (storage.getItem(n) == null && storage.getItem(o) != null) { storage.setItem(n, storage.getItem(o)); moved++; }
      } catch { /* almacenamiento no disponible */ }
    }
    return moved;
  }
  function readJSON(storage, key, fallback) {
    try { const v = JSON.parse(storage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
  }
  function writeJSON(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
  function usedBytes(storage) {
    let n = 0;
    try { for (const k of KEYS) n += k.length + (storage.getItem(k) || '').length; } catch { /* nada */ }
    return n * 2;
  }
  function clearAll(storage) { for (const k of [...KEYS, ...MIGRATE.map((m) => m[0])]) { try { storage.removeItem(k); } catch { /* nada */ } } }

  A.storage = { migrate, readJSON, writeJSON, usedBytes, clearAll, KEYS };
})();
