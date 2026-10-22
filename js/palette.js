/* AURA-X · buscador de comandos (Ctrl/Cmd + K) */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function matches(text, query) { const t = norm(text); return norm(query).split(/\s+/).filter(Boolean).every((w) => t.includes(w)); }
  function create({ getItems }) {
    const { $, h, icon } = A.ui; const dlg = $('#palette'); const input = $('#palette-input'); const list = $('#palette-list');
    let items = []; let active = 0; let seqId = 0;
    function paint() {
      list.replaceChildren();
      if (!items.length) { list.append(h('li', { class: 'palette-empty' }, 'Sin resultados')); return; }
      let group = null;
      items.forEach((it, i) => {
        if (it.group !== group) { group = it.group; list.append(h('li', { class: 'palette-group', role: 'presentation' }, group)); }
        const li = h('li', { role: 'option', id: 'pal-' + i, class: 'palette-item' + (i === active ? ' active' : ''), 'aria-selected': String(i === active) },
          h('span', { class: 'pal-icon' }, icon(it.icon || 'chevron', 16)), h('span', { class: 'pal-title' }, it.title), it.hint ? h('span', { class: 'pal-hint' }, it.hint) : null);
        li.addEventListener('mousemove', () => { if (active !== i) { active = i; paint(); } });
        li.addEventListener('click', () => run(i)); list.append(li);
      });
      const cur = $('#pal-' + active); if (cur) { cur.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', 'pal-' + active); }
    }
    let pending = Promise.resolve();
    function refresh() { const my = ++seqId; pending = (async () => { const r = await getItems(input.value); if (my !== seqId) return; items = r; active = 0; paint(); })(); return pending; }
    function run(i) { const it = items[i]; if (!it) return; dlg.close(); setTimeout(() => it.run(), 0); }
    function open() { input.value = ''; refresh(); dlg.showModal(); input.focus(); }
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = items.length ? (active + 1) % items.length : 0; paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = items.length ? (active - 1 + items.length) % items.length : 0; paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); pending.then(() => run(active)); }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    return { open };
  }
  A.palette = { create, matches };
})();
