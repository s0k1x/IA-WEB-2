/* NEXUS AI · pintado seguro de mensajes (nunca innerHTML con texto de modelos) */
(function () {
  'use strict';
  const N = (globalThis.Nexus = globalThis.Nexus || {});

  function parseBlocks(text) {
    const s = String(text);
    const out = []; const re = /```([\w+#.-]*)[^\n]*\n?([\s\S]*?)(?:```|$)/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ type: 'text', content: s.slice(last, m.index) });
      out.push({ type: 'code', lang: m[1] || '', content: m[2].replace(/\n$/, '') });
      last = re.lastIndex;
    }
    if (last < s.length) out.push({ type: 'text', content: s.slice(last) });
    return out.filter((b) => b.type === 'code' || b.content.trim() !== '');
  }

  function inlineTokens(line) {
    return String(line).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).filter(Boolean).map((p) => {
      if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) return { type: 'code', content: p.slice(1, -1) };
      if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return { type: 'bold', content: p.slice(2, -2) };
      return { type: 'text', content: p };
    });
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function appendInline(parent, line) {
    for (const t of inlineTokens(line)) {
      if (t.type === 'code') parent.append(el('code', 'inline', t.content));
      else if (t.type === 'bold') parent.append(el('strong', null, t.content));
      else parent.append(document.createTextNode(t.content));
    }
  }

  function textNodes(text) {
    const out = []; let para = []; let list = null;
    const flushPara = () => {
      if (!para.length) return;
      const p = el('p');
      para.forEach((l, i) => { if (i) p.append(document.createElement('br')); appendInline(p, l); });
      out.push(p); para = [];
    };
    const flushList = () => { if (list) { out.push(list); list = null; } };
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flushPara(); flushList(); continue; }
      const li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (li) { flushPara(); if (!list) list = el('ul'); const item = el('li'); appendInline(item, li[1]); list.append(item); continue; }
      flushList();
      const hd = /^#{1,4}\s+(.*)$/.exec(line);
      if (hd) { flushPara(); const h = el('h4'); appendInline(h, hd[1]); out.push(h); continue; }
      para.push(line);
    }
    flushPara(); flushList();
    return out;
  }

  function codeBlock(b) {
    const wrap = el('div', 'code-block');
    const head = el('div', 'code-head');
    const copy = el('button', 'small-btn', 'Copiar');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.content); copy.textContent = 'Copiado'; }
      catch { copy.textContent = 'No se pudo copiar'; }
      setTimeout(() => { copy.textContent = 'Copiar'; }, 1600);
    });
    head.append(el('span', null, b.lang || 'código'), copy);
    const pre = el('pre'); pre.append(el('code', null, b.content));
    wrap.append(head, pre);
    return wrap;
  }

  function message(m) {
    const role = ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'assistant';
    const wrap = el('div', 'msg ' + role);
    if (role !== 'system') wrap.append(el('div', 'avatar', role === 'user' ? 'TÚ' : 'N'));
    const bubble = el('div', 'bubble');
    for (const b of parseBlocks(m.text)) {
      if (b.type === 'code') bubble.append(codeBlock(b));
      else bubble.append(...textNodes(b.content));
    }
    wrap.append(bubble);
    return wrap;
  }

  N.render = { parseBlocks, inlineTokens, message };
})();
