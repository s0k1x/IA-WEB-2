/* AURA-X · proyectos: agrupan conversaciones y aportan instrucciones propias */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const KEY = 'aura.projects.v1';
  const uid = () => 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function normalize(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim()) return null;
    return { id: p.id.slice(0, 60), name: p.name.trim().slice(0, 40), instructions: String(p.instructions || '').slice(0, 4000),
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now() };
  }

  function createStore(storage) {
    const raw = A.storage.readJSON(storage, KEY, []);
    let list = (Array.isArray(raw) ? raw : []).map(normalize).filter(Boolean);
    const save = () => A.storage.writeJSON(storage, KEY, list);
    const get = (id) => list.find((p) => p.id === id) || null;
    function check(name, instructions) {
      const n = String(name || '').trim();
      if (!n) throw new Error('Ponle un nombre al proyecto');
      if (n.length > 40) throw new Error('El nombre es demasiado largo (máx. 40)');
      if (String(instructions || '').length > 4000) throw new Error('Las instrucciones superan 4000 caracteres');
      return n;
    }
    return {
      list: () => [...list].sort((a, b) => a.name.localeCompare(b.name, 'es')),
      get,
      add({ name, instructions }) {
        const n = check(name, instructions);
        if (list.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new Error('Ya existe un proyecto con ese nombre');
        const p = { id: uid(), name: n, instructions: String(instructions || ''), createdAt: Date.now() };
        list.push(p); save(); return p;
      },
      update(id, { name, instructions }) {
        const p = get(id); if (!p) throw new Error('Proyecto no encontrado');
        const n = check(name, instructions);
        if (list.some((o) => o.id !== id && o.name.toLowerCase() === n.toLowerCase())) throw new Error('Ya existe un proyecto con ese nombre');
        p.name = n; p.instructions = String(instructions || ''); save(); return p;
      },
      remove(id) { list = list.filter((p) => p.id !== id); save(); },
      importMany(items) {
        let added = 0, skipped = 0;
        for (const it of Array.isArray(items) ? items : []) {
          const p = normalize(it);
          if (!p || get(p.id) || list.some((o) => o.name.toLowerCase() === p.name.toLowerCase())) { skipped++; continue; }
          list.push(p); added++;
        }
        save(); return { added, skipped };
      },
      raw: () => list.map((p) => ({ ...p })),
    };
  }

  A.projects = { createStore, normalize };
})();
