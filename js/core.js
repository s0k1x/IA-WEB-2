/* AURA-X · utilidades comunes de la interfaz */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k in e && k !== 'list' && k !== 'form') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }

  const P = {
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>', panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
    paperclip: '<path d="M20.5 11.5l-8.3 8.3a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>',
    arrowUp: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>', pin: '<path d="M12 16v5"/><path d="M8 3h8l-1 6 3 3H6l3-3z"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8"/><path d="M10 12h4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    plug: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
    code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>', logout: '<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4"/><path d="M8 12h10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  };
  function icon(name, size = 16) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
    s.innerHTML = P[name] || ''; // solo cadenas fijas definidas arriba
    return s;
  }
  function logo(size = 24) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('fill', 'none'); s.setAttribute('aria-hidden', 'true'); s.classList.add('logo');
    s.innerHTML = '<path class="logo-a" d="M5.5 27 L15.2 5.2 Q16 3.6 16.8 5.2 L26.5 27" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path class="logo-gap" d="M5.5 27 C 11.5 19.5, 19 15.2, 30 12.6" stroke-width="5" stroke-linecap="round"/>'
      + '<path class="logo-arc" d="M5.5 27 C 11.5 19.5, 19 15.2, 30 12.6" stroke-width="2.4" stroke-linecap="round"/>';
    return s;
  }

  let toastTimer;
  function toast(msg, kind = '') {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast show ' + kind;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }

  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.el.remove(); document.removeEventListener('mousedown', openMenu.off, true); document.removeEventListener('keydown', openMenu.key, true); openMenu = null; } }
  function menu(anchor, items, align = 'left') {
    closeMenu();
    const el = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (it.separator) { el.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      if (it.heading) { el.append(h('div', { class: 'menu-heading' }, it.label)); continue; }
      const b = h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem', disabled: Boolean(it.disabled) },
        it.icon ? icon(it.icon, 15) : h('span', { class: 'menu-gap' }), h('span', null, it.label), it.hint ? h('kbd', null, it.hint) : null);
      b.addEventListener('click', () => { closeMenu(); it.run && it.run(); });
      el.append(b);
    }
    document.body.append(el);
    const r = anchor.getBoundingClientRect(); const w = el.offsetWidth, hh = el.offsetHeight;
    let left = align === 'right' ? r.right - w : r.left; left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = r.bottom + 4; if (top + hh > innerHeight - 8) top = Math.max(8, r.top - hh - 4);
    el.style.left = left + 'px'; el.style.top = top + 'px';
    const btns = $$('button:not(:disabled)', el);
    const off = (e) => { if (!el.contains(e.target)) closeMenu(); };
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus && anchor.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const i = btns.indexOf(document.activeElement); btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus(); }
    };
    document.addEventListener('mousedown', off, true); document.addEventListener('keydown', key, true);
    openMenu = { el, off, key }; btns[0] && btns[0].focus();
  }

  function ask({ title, message, confirmText = 'Confirmar', danger = false }) {
    return new Promise((resolve) => {
      const d = $('#confirm-dialog');
      $('#confirm-title').textContent = title; $('#confirm-message').textContent = message;
      const ok = $('#confirm-ok'); ok.textContent = confirmText; ok.classList.toggle('danger', danger);
      const onClose = () => { d.removeEventListener('close', onClose); resolve(d.returnValue === 'ok'); };
      d.returnValue = ''; d.addEventListener('close', onClose); d.showModal();
    });
  }

  function download(filename, data, mime = 'text/plain') {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime + ';charset=utf-8' }));
    const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  const safeName = (s, fb = 'archivo') => String(s).replace(/[^\w\-áéíóúñü ]+/gi, '').trim().replace(/\s+/g, '-').slice(0, 40) || fb;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const readJSON = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch { return fb; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  function fmtDate(iso) {
    const d = new Date(iso); const now = new Date(); const day = 86400000;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (d.getTime() >= start) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (d.getTime() >= start - day) return 'Ayer';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }
  function groupByDate(list, now = Date.now()) {
    const startToday = new Date(now).setHours(0, 0, 0, 0); const DAY = 86400000;
    const buckets = [['Fijadas', []], ['Hoy', []], ['Ayer', []], ['Últimos 7 días', []], ['Últimos 30 días', []], ['Anteriores', []]];
    for (const c of list) {
      const t = Date.parse(c.updated_at);
      if (c.pinned) buckets[0][1].push(c);
      else if (t >= startToday) buckets[1][1].push(c);
      else if (t >= startToday - DAY) buckets[2][1].push(c);
      else if (t >= startToday - 7 * DAY) buckets[3][1].push(c);
      else if (t >= startToday - 30 * DAY) buckets[4][1].push(c);
      else buckets[5][1].push(c);
    }
    return buckets.filter(([, items]) => items.length).map(([label, items]) => ({ label, items }));
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('No se pudo leer el archivo'));
      r.readAsDataURL(file);
    });
  }

  A.ui = { $, $$, h, icon, logo, toast, menu, closeMenu, ask, download, safeName, norm, readJSON, writeJSON, fmtDate, groupByDate, fileToBase64 };
})();
