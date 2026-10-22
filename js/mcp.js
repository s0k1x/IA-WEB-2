/* AURA-X · registro de conectores MCP.
   El navegador solo guarda nombre + URL. La conexión real al servidor MCP y sus
   credenciales viven en el backend (Supabase Edge Function + secretos). */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const KEY = 'aura.mcp.v1';
  const SECRET_PARAMS = /(key|token|secret|password|auth)/i;

  function validateUrl(u) {
    let x;
    try { x = new URL(u); } catch { return 'La URL no es válida'; }
    const local = ['localhost', '127.0.0.1'].includes(x.hostname);
    if (x.protocol !== 'https:' && !(local && x.protocol === 'http:')) return 'Usa https:// (http solo para localhost)';
    if (x.username || x.password) return 'No incluyas usuario ni contraseña en la URL';
    for (const k of x.searchParams.keys()) if (SECRET_PARAMS.test(k)) return 'No pongas claves en la URL: configúralas como secreto en Supabase';
    return null;
  }

  function cleanTools(tools) {
    return (Array.isArray(tools) ? tools : [])
      .filter((t) => t && typeof t.name === 'string')
      .map((t) => ({ name: t.name.slice(0, 120), description: String(t.description || '').slice(0, 500) }));
  }

  function createRegistry(storage) {
    const raw = A.storage.readJSON(storage, KEY, []);
    let list = Array.isArray(raw) ? raw.filter((s) => s && typeof s.url === 'string' && typeof s.name === 'string') : [];
    const save = () => A.storage.writeJSON(storage, KEY, list);
    const get = (id) => list.find((s) => s.id === id) || null;
    const mkId = () => 'mcp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    return {
      list: () => [...list], get,
      add({ name, url }) {
        const n = String(name || '').trim();
        const u = String(url || '').trim();
        if (!n) throw new Error('Ponle un nombre al conector');
        if (n.length > 40) throw new Error('El nombre es demasiado largo (máx. 40)');
        const err = validateUrl(u);
        if (err) throw new Error(err);
        if (list.some((s) => s.url === u)) throw new Error('Ese servidor ya está añadido');
        const s = { id: mkId(), name: n, url: u, enabled: true, tools: null };
        list.push(s); save(); return s;
      },
      remove(id) { list = list.filter((s) => s.id !== id); save(); },
      toggle(id, enabled) { const s = get(id); if (s) { s.enabled = Boolean(enabled); save(); } },
      setTools(id, tools) { const s = get(id); if (s) { s.tools = cleanTools(tools); save(); } },
      enabledForTask: () => list.filter((s) => s.enabled).map((s) => ({ name: s.name, url: s.url })),
      importMany(items) {
        let added = 0, skipped = 0;
        for (const it of Array.isArray(items) ? items : []) {
          if (!it || validateUrl(String(it.url || '')) || !String(it.name || '').trim() || list.some((s) => s.url === it.url)) { skipped++; continue; }
          list.push({ id: mkId(), name: String(it.name).trim().slice(0, 40), url: it.url, enabled: Boolean(it.enabled), tools: it.tools ? cleanTools(it.tools) : null });
          added++;
        }
        save(); return { added, skipped };
      },
      raw: () => list.map((s) => ({ ...s })),
    };
  }

  A.mcp = { createRegistry, validateUrl };
})();
