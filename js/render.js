/* AURA-X · pintado seguro de mensajes (nunca innerHTML con texto de los modelos) */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const EXT = { js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', jsx: 'jsx', tsx: 'tsx', html: 'html', htm: 'html', css: 'css', json: 'json',
    py: 'py', python: 'py', sql: 'sql', sh: 'sh', bash: 'sh', yaml: 'yml', yml: 'yml', md: 'md', markdown: 'md', svg: 'svg', xml: 'xml', java: 'java', go: 'go', rs: 'rs', php: 'php', rb: 'rb', c: 'c', cpp: 'cpp' };
  const langExt = (lang) => EXT[String(lang || '').toLowerCase()] || 'txt';
  const isPreviewable = (b) => { const l = String(b.lang || '').toLowerCase(); return l === 'html' || l === 'htm' || l === 'svg' || /^\s*(<!doctype html|<html|<svg)/i.test(b.content); };

  function parseBlocks(text) {
    const s = String(text); const out = []; const re = /```([\w+#.-]*)[^\n]*\n?([\s\S]*?)(?:```|$)/g; let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ type: 'text', content: s.slice(last, m.index) });
      out.push({ type: 'code', lang: m[1] || '', content: m[2].replace(/\n$/, ''), closed: m[0].endsWith('```') && m[0].length > 3 + m[1].length });
      last = re.lastIndex; if (m[0] === '') re.lastIndex++;
    }
    if (last < s.length) out.push({ type: 'text', content: s.slice(last) });
    return out.filter((b) => b.type === 'code' || b.content.trim() !== '');
  }
  const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|_[^_\n]+_|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/;
  function inlineTokens(line) {
    return String(line).split(INLINE).filter(Boolean).map((p) => {
      if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) return { type: 'code', content: p.slice(1, -1) };
      if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return { type: 'bold', content: p.slice(2, -2) };
      if (p.length > 2 && p.startsWith('_') && p.endsWith('_') && !/\w_\w/.test(p.slice(1, -1))) return { type: 'em', content: p.slice(1, -1) };
      const lk = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(p);
      if (lk) { try { return { type: 'link', content: lk[1], href: new URL(lk[2]).href }; } catch { /* nada */ } }
      return { type: 'text', content: p };
    });
  }
  function extractCodeBlocks(messages) {
    const out = [];
    messages.forEach((m, i) => { if (m.role !== 'assistant') return; let n = 0; for (const b of parseBlocks(m.content || '')) if (b.type === 'code' && b.content.trim()) out.push({ ...b, msgIndex: i, msgId: m.id, n: n++ }); });
    return out;
  }
  function artifactTitle(b) {
    const t = /<title>([^<]{1,60})<\/title>/i.exec(b.content); if (t) return t[1].trim();
    const first = (b.content.split('\n').find((l) => l.trim()) || '').trim();
    return `${(b.lang || 'código').toUpperCase() === 'HTML' ? 'Página' : b.lang || 'Código'}${first ? ': ' + first.replace(/^[<!/#*-]+/, '').slice(0, 36) : ''}`;
  }

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function appendInline(parent, line) {
    for (const t of inlineTokens(line)) {
      if (t.type === 'code') parent.append(el('code', 'inline', t.content));
      else if (t.type === 'bold') parent.append(el('strong', null, t.content));
      else if (t.type === 'em') parent.append(el('em', null, t.content));
      else if (t.type === 'link') { const a = el('a', null, t.content); a.href = t.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); }
      else parent.append(document.createTextNode(t.content));
    }
  }
  function textNodes(text) {
    const out = []; let para = []; let list = null; let quote = []; let table = null;
    const flushPara = () => { if (!para.length) return; const p = el('p'); para.forEach((l, i) => { if (i) p.append(document.createElement('br')); appendInline(p, l); }); out.push(p); para = []; };
    const flushList = () => { if (list) { out.push(list); list = null; } };
    const flushQuote = () => { if (!quote.length) return; const qb = el('blockquote'); quote.forEach((l, i) => { if (i) qb.append(document.createElement('br')); appendInline(qb, l); }); out.push(qb); quote = []; };
    const flushTable = () => {
      if (!table) return;
      const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)); const t = el('table'); const wrap = el('div', 'table-wrap'); wrap.append(t);
      rows.forEach((r, i) => { const tr = el('tr'); r.replace(/^\s*\||\|\s*$/g, '').split('|').forEach((c) => { const cell = el(i === 0 ? 'th' : 'td'); appendInline(cell, c.trim()); tr.append(cell); }); t.append(tr); });
      out.push(wrap); table = null;
    };
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); flushQuote(); (table = table || []).push(line); continue; }
      flushTable();
      if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
      const qm = /^>\s?(.*)$/.exec(line); if (qm) { flushPara(); flushList(); quote.push(qm[1]); continue; }
      flushQuote();
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push(el('hr')); continue; }
      const ul = /^\s*[-*]\s+(.*)$/.exec(line); const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) { flushPara(); const tag = ul ? 'ul' : 'ol'; if (!list || list.tagName.toLowerCase() !== tag) { flushList(); list = el(tag); } const li = el('li'); appendInline(li, (ul || ol)[1]); list.append(li); continue; }
      flushList();
      const hd = /^(#{1,4})\s+(.*)$/.exec(line); if (hd) { flushPara(); const hh = el(hd[1].length <= 2 ? 'h3' : 'h4'); appendInline(hh, hd[2]); out.push(hh); continue; }
      para.push(line);
    }
    flushPara(); flushList(); flushQuote(); flushTable();
    return out;
  }
  function codeBlock(b, hooks) {
    const wrap = el('div', 'code-block'); const head = el('div', 'code-head'); const tools = el('div', 'code-tools');
    const btn = (name, label, run) => { const x = el('button', 'code-btn'); x.type = 'button'; x.title = label; x.setAttribute('aria-label', label); x.append(A.ui.icon(name, 14), el('span', null, label)); x.addEventListener('click', () => run(x)); return x; };
    if (hooks.onOpen && isPreviewable(b)) tools.append(btn('eye', 'Abrir', () => hooks.onOpen(b)));
    if (hooks.onDownload) tools.append(btn('download', 'Descargar', () => hooks.onDownload(b)));
    tools.append(btn('copy', 'Copiar', async (x) => { const s = x.querySelector('span'); try { await navigator.clipboard.writeText(b.content); s.textContent = 'Copiado'; } catch { s.textContent = 'No se pudo'; } setTimeout(() => { s.textContent = 'Copiar'; }, 1500); }));
    head.append(el('span', 'code-lang', b.lang || 'código'), tools);
    const pre = el('pre'); pre.append(el('code', null, b.content)); wrap.append(head, pre);
    return wrap;
  }
  function content(text, hooks = {}) {
    const frag = document.createDocumentFragment();
    for (const b of parseBlocks(text)) frag.append(...(b.type === 'code' ? [codeBlock(b, hooks)] : textNodes(b.content)));
    return frag;
  }

  A.render = { parseBlocks, inlineTokens, extractCodeBlocks, isPreviewable, langExt, artifactTitle, content };
})();
