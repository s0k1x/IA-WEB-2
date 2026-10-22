/* AURA-X · pintado seguro de mensajes (nunca innerHTML con texto de modelos) */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const EXT = { js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', jsx: 'jsx', tsx: 'tsx', html: 'html', htm: 'html', css: 'css',
    json: 'json', py: 'py', python: 'py', sql: 'sql', sh: 'sh', bash: 'sh', yaml: 'yml', yml: 'yml', md: 'md', markdown: 'md', svg: 'svg', xml: 'xml', java: 'java', go: 'go', rs: 'rs', php: 'php', rb: 'rb' };

  const langExt = (lang) => EXT[String(lang || '').toLowerCase()] || 'txt';
  function isPreviewable(b) {
    const l = String(b.lang || '').toLowerCase();
    return l === 'html' || l === 'htm' || l === 'svg' || /^\s*(<!doctype html|<html)/i.test(b.content);
  }

  function parseBlocks(text) {
    const s = String(text);
    const out = []; const re = /```([\w+#.-]*)[^\n]*\n?([\s\S]*?)(?:```|$)/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ type: 'text', content: s.slice(last, m.index) });
      out.push({ type: 'code', lang: m[1] || '', content: m[2].replace(/\n$/, '') });
      last = re.lastIndex;
      if (m[0] === '') re.lastIndex++;
    }
    if (last < s.length) out.push({ type: 'text', content: s.slice(last) });
    return out.filter((b) => b.type === 'code' || b.content.trim() !== '');
  }

  const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/;
  function inlineTokens(line) {
    return String(line).split(INLINE).filter(Boolean).map((p) => {
      if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) return { type: 'code', content: p.slice(1, -1) };
      if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return { type: 'bold', content: p.slice(2, -2) };
      const lk = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(p);
      if (lk) { try { return { type: 'link', content: lk[1], href: new URL(lk[2]).href }; } catch { /* URL inválida */ } }
      return { type: 'text', content: p };
    });
  }

  function extractCodeBlocks(messages) {
    const out = [];
    messages.forEach((m, i) => {
      if (m.role !== 'assistant') return;
      for (const b of parseBlocks(m.text)) if (b.type === 'code' && b.content.trim()) out.push({ ...b, msgIndex: i });
    });
    return out;
  }

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function appendInline(parent, line) {
    for (const t of inlineTokens(line)) {
      if (t.type === 'code') parent.append(el('code', 'inline', t.content));
      else if (t.type === 'bold') parent.append(el('strong', null, t.content));
      else if (t.type === 'link') { const a = el('a', null, t.content); a.href = t.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); }
      else parent.append(document.createTextNode(t.content));
    }
  }

  function textNodes(text) {
    const out = []; let para = []; let list = null; let quote = [];
    const flushPara = () => {
      if (!para.length) return;
      const p = el('p');
      para.forEach((l, i) => { if (i) p.append(document.createElement('br')); appendInline(p, l); });
      out.push(p); para = [];
    };
    const flushList = () => { if (list) { out.push(list); list = null; } };
    const flushQuote = () => {
      if (!quote.length) return;
      const q = el('blockquote'); quote.forEach((l, i) => { if (i) q.append(document.createElement('br')); appendInline(q, l); });
      out.push(q); quote = [];
    };
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
      const qm = /^>\s?(.*)$/.exec(line);
      if (qm) { flushPara(); flushList(); quote.push(qm[1]); continue; }
      flushQuote();
      const ul = /^\s*[-*]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        flushPara();
        const tag = ul ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) { flushList(); list = el(tag); }
        const item = el('li'); appendInline(item, (ul || ol)[1]); list.append(item); continue;
      }
      flushList();
      const hd = /^#{1,4}\s+(.*)$/.exec(line);
      if (hd) { flushPara(); const hh = el('h4'); appendInline(hh, hd[1]); out.push(hh); continue; }
      para.push(line);
    }
    flushPara(); flushList(); flushQuote();
    return out;
  }

  function iconBtn(name, label, run, cls = 'small-btn') {
    const b = el('button', cls); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
    if (A.ui) b.append(A.ui.icon(name, 14));
    if (cls === 'small-btn') b.append(el('span', null, label));
    b.addEventListener('click', () => run(b));
    return b;
  }

  function codeBlock(b, hooks) {
    const wrap = el('div', 'code-block');
    const head = el('div', 'code-head');
    const tools = el('div', 'code-tools');
    if (hooks.onPreview && isPreviewable(b)) tools.append(iconBtn('eye', 'Vista previa', () => hooks.onPreview(b)));
    if (hooks.onDownload) tools.append(iconBtn('download', 'Descargar', () => hooks.onDownload(b)));
    tools.append(iconBtn('copy', 'Copiar', async (btn) => {
      const span = btn.querySelector('span');
      try { await navigator.clipboard.writeText(b.content); span.textContent = 'Copiado'; } catch { span.textContent = 'No se pudo'; }
      setTimeout(() => { span.textContent = 'Copiar'; }, 1600);
    }));
    head.append(el('span', 'code-lang', b.lang || 'código'), tools);
    const pre = el('pre'); pre.append(el('code', null, b.content));
    wrap.append(head, pre);
    return wrap;
  }

  function message(m, opts = {}) {
    const hooks = { onPreview: opts.onPreview, onDownload: opts.onDownload };
    const role = ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'assistant';
    const wrap = el('div', 'msg ' + role);
    if (role === 'assistant') {
      const av = el('div', 'avatar'); const img = document.createElement('img');
      img.src = 'icons/aura-mark.png'; img.alt = ''; img.width = 22; img.height = 22; av.append(img); wrap.append(av);
    } else if (role === 'user') wrap.append(el('div', 'avatar', 'TÚ'));
    const body = el('div', 'msg-body');
    const bubble = el('div', 'bubble');
    for (const b of parseBlocks(m.text)) {
      if (b.type === 'code') bubble.append(codeBlock(b, hooks));
      else bubble.append(...textNodes(b.content));
    }
    body.append(bubble);
    if (opts.actions && opts.actions.length) {
      const bar = el('div', 'msg-actions');
      for (const a of opts.actions) bar.append(iconBtn(a.icon, a.label, a.run, 'act-btn'));
      body.append(bar);
    }
    wrap.append(body);
    return wrap;
  }

  A.render = { parseBlocks, inlineTokens, extractCodeBlocks, isPreviewable, langExt, message };
})();
