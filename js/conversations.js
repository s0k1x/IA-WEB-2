/* NEXUS AI · conversaciones guardadas en el navegador (hasta sincronizar con Supabase) */
(function () {
  'use strict';
  const N = (globalThis.Nexus = globalThis.Nexus || {});
  const KEY = 'nexus.convs.v1';
  const NEW_TITLE = 'Nueva conversación';
  const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

  function makeTitle(text) {
    const s = String(text).replace(/\s+/g, ' ').trim();
    if (!s) return 'Conversación';
    return s.length > 42 ? s.slice(0, 40) + '…' : s;
  }

  function createStore(storage) {
    let data;
    try { data = JSON.parse(storage.getItem(KEY)) || { list: [] }; } catch { data = { list: [] }; }
    if (!Array.isArray(data.list)) data = { list: [] };
    const save = () => { try { storage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; } };
    const get = (id) => data.list.find((c) => c.id === id) || null;
    const all = () => [...data.list].sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      all, get,
      create() {
        const now = Date.now();
        const c = { id: uid(), title: NEW_TITLE, createdAt: now, updatedAt: now, remoteId: null, messages: [] };
        data.list.push(c); save(); return c;
      },
      addMessage(id, role, text) {
        const c = get(id);
        if (!c) throw new Error('Conversación no encontrada');
        c.messages.push({ role, text: String(text), at: Date.now() });
        c.updatedAt = Date.now();
        if (c.title === NEW_TITLE && role === 'user') c.title = makeTitle(text);
        save(); return c;
      },
      setRemote(id, remoteId) { const c = get(id); if (c) { c.remoteId = remoteId; save(); } },
      byRemote(remoteId) { return data.list.find((c) => remoteId && c.remoteId === remoteId) || null; },
      rename(id, title) { const c = get(id); if (c) { c.title = makeTitle(title); save(); } },
      remove(id) { data.list = data.list.filter((c) => c.id !== id); save(); },
      search(q) {
        const s = String(q || '').trim().toLowerCase();
        if (!s) return all();
        return all().filter((c) => c.title.toLowerCase().includes(s) || c.messages.some((m) => m.text.toLowerCase().includes(s)));
      },
    };
  }

  N.convs = { createStore, makeTitle, NEW_TITLE };
})();
