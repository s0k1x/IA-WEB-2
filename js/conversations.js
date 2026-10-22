/* AURA-X · conversaciones guardadas en el navegador (hasta sincronizar con Supabase) */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const KEY = 'aura.convs.v1';
  const NEW_TITLE = 'Nueva conversación';
  const ROLES = ['user', 'assistant', 'system'];
  const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

  function makeTitle(text) {
    const s = String(text).replace(/\n\nAdjuntos: [^\n]*$/, '').replace(/\s+/g, ' ').trim();
    if (!s) return 'Conversación';
    return s.length > 42 ? s.slice(0, 40) + '…' : s;
  }

  // Valida y normaliza una conversación (también para importar copias de seguridad).
  function normalize(c) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) return null;
    const msgs = (Array.isArray(c.messages) ? c.messages : [])
      .filter((m) => m && ROLES.includes(m.role) && typeof m.text === 'string')
      .slice(0, 5000)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 200000), at: Number.isFinite(m.at) ? m.at : Date.now() }));
    const now = Date.now();
    return {
      id: c.id.slice(0, 80),
      title: typeof c.title === 'string' && c.title.trim() ? c.title.slice(0, 120) : NEW_TITLE,
      createdAt: Number.isFinite(c.createdAt) ? c.createdAt : now,
      updatedAt: Number.isFinite(c.updatedAt) ? c.updatedAt : now,
      remoteId: typeof c.remoteId === 'string' ? c.remoteId : null,
      pinned: Boolean(c.pinned), archived: Boolean(c.archived),
      projectId: typeof c.projectId === 'string' ? c.projectId : null,
      messages: msgs,
    };
  }

  const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function groupByDate(list, now = Date.now()) {
    const startToday = new Date(now).setHours(0, 0, 0, 0);
    const DAY = 86400000;
    const buckets = [['Fijadas', []], ['Hoy', []], ['Ayer', []], ['Últimos 7 días', []], ['Anteriores', []]];
    for (const c of list) {
      if (c.pinned) buckets[0][1].push(c);
      else if (c.updatedAt >= startToday) buckets[1][1].push(c);
      else if (c.updatedAt >= startToday - DAY) buckets[2][1].push(c);
      else if (c.updatedAt >= startToday - 7 * DAY) buckets[3][1].push(c);
      else buckets[4][1].push(c);
    }
    return buckets.filter(([, items]) => items.length).map(([label, items]) => ({ label, items }));
  }

  function toMarkdown(conv, brand = 'AURA-X') {
    const out = [`# ${conv.title}`, '', `_Exportado desde ${brand} · ${new Date().toLocaleString('es-ES')}_`, ''];
    for (const m of conv.messages) {
      out.push(`## ${m.role === 'user' ? 'Tú' : m.role === 'assistant' ? brand : 'Sistema'}`, '', m.text, '');
    }
    return out.join('\n');
  }

  function createStore(storage) {
    const raw = A.storage.readJSON(storage, KEY, { list: [] });
    let data = { list: (Array.isArray(raw.list) ? raw.list : []).map(normalize).filter(Boolean) };
    const save = () => A.storage.writeJSON(storage, KEY, data);
    const get = (id) => data.list.find((c) => c.id === id) || null;
    const byRecent = (a, b) => b.updatedAt - a.updatedAt;

    function list({ query = '', project = 'all', archived = false } = {}) {
      const q = norm(query).trim();
      return data.list
        .filter((c) => c.archived === archived)
        .filter((c) => project === 'all' || (project === 'none' ? !c.projectId : c.projectId === project))
        .filter((c) => !q || norm(c.title).includes(q) || c.messages.some((m) => norm(m.text).includes(q)))
        .sort(byRecent);
    }

    return {
      list, get,
      all: () => [...data.list].sort(byRecent),
      count: () => data.list.length,
      archivedCount: (project = 'all') => list({ archived: true, project }).length,
      create({ projectId = null } = {}) {
        const now = Date.now();
        const c = { id: uid(), title: NEW_TITLE, createdAt: now, updatedAt: now, remoteId: null, pinned: false, archived: false, projectId, messages: [] };
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
      deleteMessage(id, index) { const c = get(id); if (c && index >= 0 && index < c.messages.length) { c.messages.splice(index, 1); save(); } },
      truncateFrom(id, index) { const c = get(id); if (c && index >= 0) { c.messages.splice(index); c.updatedAt = Date.now(); save(); } },
      setRemote(id, remoteId) { const c = get(id); if (c) { c.remoteId = remoteId; save(); } },
      byRemote(remoteId) { return data.list.find((c) => remoteId && c.remoteId === remoteId) || null; },
      rename(id, title) { const c = get(id); if (c && String(title).trim()) { c.title = makeTitle(title); save(); } },
      pin(id, on) { const c = get(id); if (c) { c.pinned = Boolean(on); save(); } },
      archive(id, on) { const c = get(id); if (c) { c.archived = Boolean(on); if (on) c.pinned = false; save(); } },
      setProject(id, projectId) { const c = get(id); if (c) { c.projectId = projectId || null; save(); } },
      clearProject(projectId) { for (const c of data.list) if (c.projectId === projectId) c.projectId = null; save(); },
      remove(id) { data.list = data.list.filter((c) => c.id !== id); save(); },
      importMany(items) {
        let added = 0, skipped = 0;
        for (const it of Array.isArray(items) ? items : []) {
          const c = normalize(it);
          if (!c || get(c.id)) { skipped++; continue; }
          data.list.push(c); added++;
        }
        save(); return { added, skipped };
      },
      raw: () => data.list.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m })) })),
      stats() {
        let messages = 0;
        for (const c of data.list) messages += c.messages.length;
        return { conversations: data.list.length, messages };
      },
    };
  }

  A.convs = { createStore, makeTitle, normalize, groupByDate, toMarkdown, NEW_TITLE };
})();
