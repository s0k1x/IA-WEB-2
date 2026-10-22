/* AURA-X · interfaz principal */
(function () {
  'use strict';
  const A = window.Aura;
  const { api, convs, mcp, render, store, prompts, ui, backup } = A;
  const { $, h, icon, toast } = ui;

  A.storage.migrate(localStorage);
  const conversations = convs.createStore(localStorage);
  const projectStore = A.projects.createStore(localStorage);
  const servers = mcp.createRegistry(localStorage);
  const tasks = new Map(); // id -> { id, state, convId, logFrom }

  const PREFS_KEY = 'aura.prefs.v1';
  const DEFAULT_PREFS = {
    tier: 'general', confirmDestructive: true, reviewAgents: false, webSearch: false, autonomous: false, notify: false,
    budgetUsd: '', maxReviewRounds: 2, instructions: '', agentsAuto: true, agents: [], theme: 'dark', sidebarCollapsed: false,
  };
  let prefs = { ...DEFAULT_PREFS, ...A.storage.readJSON(localStorage, PREFS_KEY, {}) };
  const savePrefs = () => A.storage.writeJSON(localStorage, PREFS_KEY, prefs);

  let currentId = null, polling = false, pollTimer = null, attachments = [], loaderLabel = null;
  let filterProject = 'all', showArchived = false, renamingId = null, slashItems = [], slashIndex = 0;
  let recognition = null;

  const isNarrowSide = () => window.matchMedia('(max-width: 900px)').matches;
  const isNarrowAct = () => window.matchMedia('(max-width: 1180px)').matches;
  const currentConv = () => (currentId ? conversations.get(currentId) : null);
  const tasksOf = (convId) => [...tasks.values()].filter((t) => t.convId === convId);
  const latestTask = (convId) => { const l = tasksOf(convId); return l[l.length - 1] || null; };
  const busy = () => Boolean(currentId) && tasksOf(currentId).some((t) => store.isActive(t.state));
  const ATTACH_NOTE = /\n\nAdjuntos: [^\n]*$/;
  const plain = (text) => String(text).replace(ATTACH_NOTE, '');

  /* ---------- tema ---------- */
  function applyTheme() {
    document.documentElement.dataset.theme = prefs.theme;
    const light = prefs.theme === 'light' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = light ? '#f4f6fb' : '#05070b';
  }
  function cycleTheme() {
    prefs.theme = { dark: 'light', light: 'system', system: 'dark' }[prefs.theme] || 'dark';
    savePrefs(); applyTheme(); toast(`Tema: ${{ dark: 'oscuro', light: 'claro', system: 'del sistema' }[prefs.theme]}`);
  }

  /* ---------- conexión ---------- */
  function setConn(ok, detail) {
    const b = $('#conn'); b.dataset.ok = String(ok);
    const text = ok ? 'Conectado' : 'Sin conexión' + (detail ? ` · ${detail}` : '');
    b.querySelector('.badge-text').textContent = text; b.title = ok ? 'Supabase conectado' : text;
  }
  async function checkBackend() {
    if (!api.isConfigured()) { setConn(false, 'sin configurar'); $('#setup').hidden = false; return false; }
    try { await api.health(); setConn(true); $('#setup').hidden = true; return true; }
    catch (e) { setConn(false, e.message); return false; }
  }

  /* ---------- proyectos ---------- */
  function filterProjectId() { return filterProject === 'all' || filterProject === 'none' ? null : filterProject; }
  function renderProjectFilter() {
    const sel = $('#project-filter');
    const opts = [h('option', { value: 'all' }, 'Todos los proyectos'), h('option', { value: 'none' }, 'Sin proyecto'),
      ...projectStore.list().map((p) => h('option', { value: p.id }, p.name))];
    sel.replaceChildren(...opts);
    if (filterProject !== 'all' && filterProject !== 'none' && !projectStore.get(filterProject)) filterProject = 'all';
    sel.value = filterProject;
  }

  /* ---------- lista de conversaciones ---------- */
  function convItem(c) {
    const proj = c.projectId ? projectStore.get(c.projectId) : null;
    const li = h('li', { class: 'conv-item' + (c.id === currentId ? ' active' : '') });
    if (renamingId === c.id) {
      const inp = h('input', { class: 'rename-input', type: 'text', value: c.title, maxLength: 120, 'aria-label': 'Nuevo título' });
      const finish = (save) => { if (renamingId !== c.id) return; renamingId = null; if (save && inp.value.trim()) conversations.rename(c.id, inp.value); renderConvList(); updateTitle(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
      inp.addEventListener('blur', () => finish(true));
      li.append(inp); requestAnimationFrame(() => { inp.focus(); inp.select(); });
      return li;
    }
    const open = h('button', { class: 'conv-open', type: 'button', title: c.title, onclick: () => openConversation(c.id) },
      c.pinned ? h('span', { class: 'conv-pin' }, icon('pin', 12)) : null,
      h('span', { class: 'conv-title' }, c.title),
      proj && filterProject === 'all' ? h('span', { class: 'conv-proj' }, proj.name) : null);
    const more = h('button', { class: 'conv-more', type: 'button', 'aria-label': `Opciones de «${c.title}»`, 'aria-haspopup': 'menu' }, icon('more', 16));
    more.addEventListener('click', (e) => { e.stopPropagation(); openConvMenu(more, c); });
    open.addEventListener('contextmenu', (e) => { e.preventDefault(); openConvMenu(more, c); });
    li.append(open, more);
    return li;
  }

  function openConvMenu(anchor, c) {
    const projects = projectStore.list();
    const items = [
      { label: 'Renombrar', icon: 'edit', run: () => { renamingId = c.id; renderConvList(); } },
      { label: c.pinned ? 'Quitar de fijadas' : 'Fijar arriba', icon: 'pin', run: () => { conversations.pin(c.id, !c.pinned); renderConvList(); } },
      { label: c.archived ? 'Desarchivar' : 'Archivar', icon: 'archive', run: () => { conversations.archive(c.id, !c.archived); if (c.id === currentId && !c.archived) newConversation(); renderConvList(); } },
      { separator: true },
      ...(projects.length ? [
        { label: 'Mover a proyecto', heading: true },
        ...projects.map((p) => ({ label: p.name, icon: 'folder', disabled: c.projectId === p.id, run: () => { conversations.setProject(c.id, p.id); renderConvList(); updateTitle(); toast(`Movida a «${p.name}»`); } })),
        { label: 'Sin proyecto', icon: 'x', disabled: !c.projectId, run: () => { conversations.setProject(c.id, null); renderConvList(); updateTitle(); } },
        { separator: true },
      ] : []),
      { label: 'Exportar en Markdown', icon: 'download', run: () => exportMarkdown(c) },
      { label: 'Eliminar', icon: 'trash', danger: true, run: () => deleteConversation(c.id) },
    ];
    ui.menu(anchor, items);
  }

  function renderConvList() {
    const box = $('#conv-list');
    const list = conversations.list({ query: $('#conv-search').value, project: filterProject, archived: showArchived });
    const groups = showArchived ? (list.length ? [{ label: 'Archivadas', items: list }] : []) : convs.groupByDate(list);
    box.replaceChildren();
    for (const g of groups) {
      box.append(h('p', { class: 'group-label' }, g.label), h('ul', { class: 'conv-list' }, g.items.map(convItem)));
    }
    if (!groups.length) box.append(h('p', { class: 'hint pad' }, $('#conv-search').value ? 'Sin resultados' : showArchived ? 'No hay conversaciones archivadas' : 'Aún no hay conversaciones'));
    const nArch = conversations.archivedCount(filterProject);
    const tgl = $('#toggle-archived');
    tgl.hidden = !nArch && !showArchived;
    tgl.textContent = showArchived ? '← Volver a las conversaciones' : `Archivadas (${nArch})`;
  }

  function updateTitle() {
    const c = currentConv();
    $('#chat-title').textContent = c ? c.title : 'Nueva conversación';
    const p = c && c.projectId ? projectStore.get(c.projectId) : null;
    const pill = $('#chat-project'); pill.hidden = !p; pill.textContent = p ? p.name : '';
    document.title = c ? `${c.title} · AURA-X` : 'AURA-X';
  }

  /* ---------- mensajes ---------- */
  function emptyState() {
    const ideas = [
      { ico: 'layers', t: 'Construir una app', d: 'Plan, código y pruebas por fases', cmd: 'plan' },
      { ico: 'shield', t: 'Auditar la seguridad', d: 'Secretos, permisos e inyección', cmd: 'seguridad' },
      { ico: 'database', t: 'Diseñar la base de datos', d: 'Esquema, índices y RLS', cmd: 'bd' },
      { ico: 'wallet', t: 'Reducir costes', d: 'Menos tokens, misma calidad', cmd: 'costes' },
    ];
    const done = [api.isConfigured(), servers.list().length > 0, Boolean(prefs.instructions.trim())];
    const steps = [
      { t: 'Conecta tu proyecto de Supabase', run: () => openSettings('conn') },
      { t: 'Añade un conector MCP', run: () => openMcpAdd() },
      { t: 'Escribe tus instrucciones personales', run: () => openSettings('instr') },
    ];
    const onboarding = done.every(Boolean) ? null : h('div', { class: 'onboard' },
      h('p', { class: 'section-title' }, 'Primeros pasos'),
      ...steps.map((s, i) => h('button', { class: 'onboard-step' + (done[i] ? ' done' : ''), type: 'button', onclick: s.run },
        h('span', { class: 'check-dot' }, done[i] ? icon('check', 12) : null), h('span', null, s.t))));
    return h('div', { class: 'empty' },
      h('img', { class: 'hero-logo', src: 'icons/aura-logo.webp', alt: 'AURA-X', width: 176, height: 176 }),
      h('h1', null, '¿Qué construimos hoy?'),
      h('p', { class: 'lead' }, 'AURA-X coordina varios agentes de IA para planificar, construir, revisar y probar tu proyecto.'),
      h('div', { class: 'quick-grid' }, ...ideas.map((i) => h('button', { class: 'quick-card', type: 'button', onclick: () => useTemplate(prompts.SLASH.find((s) => s.cmd === i.cmd)) },
        h('span', { class: 'quick-ico' }, icon(i.ico, 18)), h('span', { class: 'quick-t' }, i.t), h('span', { class: 'quick-d' }, i.d)))),
      onboarding);
  }

  function messageEl(m, i, isLast) {
    const actions = [];
    if (m.role !== 'system') actions.push({ icon: 'copy', label: 'Copiar mensaje', run: async (b) => {
      try { await navigator.clipboard.writeText(plain(m.text)); toast('Mensaje copiado'); } catch { toast('No se pudo copiar'); }
    } });
    if (m.role === 'user') actions.push({ icon: 'edit', label: 'Editar y reenviar', run: () => editMessage(i) });
    if (m.role === 'assistant' && isLast) actions.push({ icon: 'refresh', label: 'Regenerar respuesta', run: () => regenerate(i) });
    actions.push({ icon: 'trash', label: 'Borrar mensaje', run: () => { if (busy()) return toast('Detén la tarea en curso primero'); conversations.deleteMessage(currentId, i); renderMessages(); renderConvList(); renderCodeTab(); } });
    return render.message(m, { actions, onPreview: (b) => openPreview(b.content, b.lang), onDownload: downloadCode });
  }

  function renderMessages() {
    const box = $('#messages'); const c = currentConv();
    if (!c || !c.messages.length) { box.replaceChildren(emptyState()); return; }
    const last = c.messages.length - 1;
    box.replaceChildren(...c.messages.map((m, i) => messageEl(m, i, i === last)));
    box.scrollTop = box.scrollHeight;
  }
  function appendMessage() { renderMessages(); renderCodeTab(); }
  function note(text) { const c = currentConv(); if (c) { conversations.addMessage(c.id, 'system', text); appendMessage(); } else toast(text); }

  function openConversation(id) { currentId = id; renderConvList(); renderMessages(); updateTitle(); updateActivity(); renderCodeTab(); closeDrawers(); }
  function newConversation() {
    currentId = null; attachments = []; renderAttachments(); showArchived = false; renderConvList(); renderMessages(); updateTitle(); updateActivity(); renderCodeTab();
    closeDrawers(); $('#chat-input').focus();
  }
  async function deleteConversation(id) {
    const c = conversations.get(id); if (!c) return;
    if (!(await ui.ask({ title: 'Eliminar conversación', message: `Se borrará «${c.title}» de este navegador. No se puede deshacer.`, confirmText: 'Eliminar', danger: true }))) return;
    conversations.remove(id);
    if (currentId === id) currentId = null;
    renderConvList(); renderMessages(); updateTitle(); updateActivity(); renderCodeTab();
  }

  function editMessage(i) {
    if (busy()) return toast('Detén la tarea en curso antes de editar');
    const c = currentConv(); if (!c) return;
    const text = plain(c.messages[i].text);
    conversations.truncateFrom(c.id, i);
    renderMessages(); renderConvList(); renderCodeTab();
    const input = $('#chat-input'); input.value = text; autoGrow(); updateTokens(); input.focus();
  }
  function regenerate(i) {
    if (busy()) return toast('Hay una tarea en curso');
    const c = currentConv(); if (!c) return;
    let u = i; while (u >= 0 && c.messages[u].role !== 'user') u--;
    if (u < 0) return toast('No hay un mensaje tuyo que reenviar');
    const text = plain(c.messages[u].text);
    conversations.truncateFrom(c.id, u + 1);
    renderMessages(); send(text, { resend: true });
  }

  /* ---------- exportar ---------- */
  function exportJSON() {
    const c = currentConv(); if (!c || !c.messages.length) { toast('No hay conversación que exportar'); return false; }
    const data = { app: 'AURA-X', version: backup.VERSION, exportedAt: new Date().toISOString(), conversation: { title: c.title, createdAt: new Date(c.createdAt).toISOString(), messages: c.messages } };
    ui.downloadText(`aura-x-${ui.safeName(c.title, 'conversacion')}.json`, JSON.stringify(data, null, 2), 'application/json');
    return true;
  }
  function exportMarkdown(c = currentConv()) {
    if (!c || !c.messages.length) return toast('No hay conversación que exportar');
    ui.downloadText(`aura-x-${ui.safeName(c.title, 'conversacion')}.md`, convs.toMarkdown(c), 'text/markdown');
  }
  function downloadBackup() {
    const data = backup.build({ conversations, projects: projectStore, servers, prefs });
    ui.downloadText(`aura-x-copia-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Copia de seguridad descargada (sin claves ni tokens)');
  }
  async function importBackupFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast('El archivo es demasiado grande');
    const res = backup.parse(await file.text());
    if (!res.ok) return toast(res.error);
    const d = res.data;
    if (!(await ui.ask({ title: 'Importar copia de seguridad', message: `Se añadirán hasta ${d.conversations.length} conversaciones, ${d.projects.length} proyectos y ${d.mcp.length} conectores. Lo que ya existe no se sobrescribe.`, confirmText: 'Importar' }))) return;
    const r = backup.restore(d, { conversations, projects: projectStore, servers });
    renderProjectFilter(); renderConvList(); renderServers(); renderMessages(); updateStats();
    toast(`Importado: ${r.conversations.added} conversaciones, ${r.projects.added} proyectos, ${r.mcp.added} conectores`);
  }

  /* ---------- código: vista previa y descarga ---------- */
  function downloadCode(b) {
    const ext = render.langExt(b.lang);
    ui.downloadText(`aura-x-codigo.${ext}`, b.content, ext === 'html' ? 'text/html' : 'text/plain');
  }
  let previewBlock = null;
  function openPreview(content, lang) {
    previewBlock = { content, lang };
    const isSvg = String(lang).toLowerCase() === 'svg' || /^\s*<svg/i.test(content);
    $('#preview-title').textContent = isSvg ? 'Vista previa · SVG' : 'Vista previa · HTML';
    $('#preview-frame').srcdoc = isSvg ? `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${content}</body>` : content;
    setPreviewWidth('100%');
    $('#preview-dialog').showModal();
  }
  function setPreviewWidth(w) {
    $('#preview-frame').style.width = w;
    document.querySelectorAll('#preview-devices button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.w === w)));
  }
  function renderCodeTab() {
    const c = currentConv(); const blocks = c ? render.extractCodeBlocks(c.messages) : [];
    $('#code-count').textContent = String(blocks.length); $('#code-count').hidden = !blocks.length;
    $('#code-empty').hidden = blocks.length > 0;
    $('#code-list').replaceChildren(...blocks.map((b) => {
      const first = b.content.split('\n').find((l) => l.trim()) || '';
      const row = h('li', { class: 'code-row' },
        h('div', { class: 'code-row-info' }, h('strong', null, b.lang || 'código'), h('span', null, first.trim().slice(0, 60))),
        h('div', { class: 'code-row-actions' },
          render.isPreviewable(b) ? h('button', { class: 'act-btn', type: 'button', title: 'Vista previa', 'aria-label': 'Vista previa', onclick: () => openPreview(b.content, b.lang) }, icon('eye', 15)) : null,
          h('button', { class: 'act-btn', type: 'button', title: 'Copiar', 'aria-label': 'Copiar código', onclick: async () => { try { await navigator.clipboard.writeText(b.content); toast('Código copiado'); } catch { toast('No se pudo copiar'); } } }, icon('copy', 15)),
          h('button', { class: 'act-btn', type: 'button', title: 'Descargar', 'aria-label': 'Descargar código', onclick: () => downloadCode(b) }, icon('download', 15))));
      return row;
    }));
  }

  /* ---------- enviar y seguir tareas ---------- */
  function buildPayload(conv, text, files) {
    const proj = conv.projectId ? projectStore.get(conv.projectId) : null;
    const budget = parseFloat(prefs.budgetUsd);
    return {
      conversationId: conv.remoteId, prompt: text,
      attachments: files.map(({ name, size, content }) => ({ name, size, content })),
      tier: prefs.tier,
      instructions: { global: prefs.instructions.trim() || null, project: proj && proj.instructions.trim() ? proj.instructions.trim() : null, projectName: proj ? proj.name : null },
      options: {
        confirmDestructive: prefs.confirmDestructive, reviewAgents: prefs.reviewAgents, webSearch: prefs.webSearch, autonomous: prefs.autonomous,
        maxReviewRounds: Number(prefs.maxReviewRounds) || 2, budgetUsd: Number.isFinite(budget) && budget > 0 ? budget : null,
        agents: prefs.agentsAuto ? null : prefs.agents,
      },
      mcpServers: servers.enabledForTask(),
    };
  }

  async function send(textOverride, { resend = false } = {}) {
    const input = $('#chat-input');
    const text = (textOverride != null ? textOverride : input.value).trim();
    if (!text && !attachments.length) return;
    if (!currentId) currentId = conversations.create({ projectId: filterProjectId() }).id;
    const files = resend ? [] : attachments;
    if (!resend) {
      conversations.addMessage(currentId, 'user', text + (files.length ? `\n\nAdjuntos: ${files.map((a) => a.name).join(', ')}` : ''));
      input.value = ''; autoGrow(); updateTokens(); attachments = []; renderAttachments();
    }
    appendMessage(); renderConvList(); updateTitle();
    const conv = currentConv();

    if (!(await checkBackend())) {
      note('Mensaje guardado en este navegador. Para que AURA-X responda, conecta Supabase en Configuración.');
      return;
    }
    const waiting = tasksOf(currentId).find((t) => t.state.status === 'awaiting_user');
    try {
      if (waiting) { await api.answerTask(waiting.id, text); startPolling(); return; }
      const res = await api.createTask(buildPayload(conv, text, files));
      if (!res || !res.taskId) throw new Error('respuesta sin taskId');
      if (res.conversationId) conversations.setRemote(currentId, res.conversationId);
      tasks.set(res.taskId, { id: res.taskId, state: store.emptyTask(res.taskId), convId: currentId, logFrom: 0 });
      updateActivity(); startPolling();
    } catch (e) { note(`No se pudo enviar: ${e.message}`); }
  }

  async function pollOnce() {
    let anyActive = false;
    for (const entry of tasks.values()) {
      if (!store.isActive(entry.state)) continue;
      anyActive = true;
      let evs;
      try { evs = await api.events(entry.id, entry.state.lastSeq); }
      catch (e) { setConn(false, e.message); continue; }
      if (!Array.isArray(evs)) continue;
      const prev = entry.state.status; let newMsgs = false;
      for (const ev of evs) {
        const before = entry.state.messages.length;
        entry.state = store.applyEvent(entry.state, ev);
        for (const m of entry.state.messages.slice(before)) {
          if (!conversations.get(entry.convId)) continue;
          conversations.addMessage(entry.convId, m.role === 'user' ? 'user' : 'assistant', m.text); newMsgs = true;
        }
      }
      if (newMsgs && entry.convId === currentId) appendMessage();
      if (entry.state.status !== prev) onStatusChange(entry);
    }
    updateActivity(); renderConvList(); updateUsage();
    return anyActive;
  }
  async function loop() {
    if (!polling) return;
    const active = await pollOnce();
    if (!active) { polling = false; return; }
    pollTimer = setTimeout(loop, 2500);
  }
  function startPolling() { if (!polling) { polling = true; loop(); } }

  function onStatusChange(entry) {
    const s = entry.state.status; const label = store.STATUS_ES[s] || s;
    if (s === 'awaiting_user') toast('AURA-X necesita tu respuesta');
    if (s === 'awaiting_authorization') toast('AURA-X espera tu autorización');
    if (prefs.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted'
      && ['completed', 'failed', 'awaiting_user', 'awaiting_authorization'].includes(s)) {
      const c = conversations.get(entry.convId);
      new Notification('AURA-X', { body: `${c ? c.title + ': ' : ''}${label}`, tag: entry.id });
    }
  }

  async function resume() {
    if (!(await checkBackend())) return;
    try {
      const list = await api.activeTasks();
      for (const row of Array.isArray(list) ? list : []) {
        if (!row || !row.id || tasks.has(row.id)) continue;
        let conv = conversations.byRemote(row.conversationId);
        if (!conv) { conv = conversations.create(); conversations.rename(conv.id, 'Tarea recuperada'); conversations.setRemote(conv.id, row.conversationId || null); }
        tasks.set(row.id, { id: row.id, state: store.emptyTask(row.id), convId: conv.id, logFrom: 0 });
      }
      renderConvList();
      if (tasks.size) startPolling();
    } catch (e) { setConn(false, e.message); }
  }

  /* ---------- panel de actividad ---------- */
  function fill(sel, items, empty) {
    $(sel).replaceChildren(...(items.length ? items.map((t) => h('li', null, t)) : [h('li', { class: 'muted' }, empty)]));
  }
  function setLoaderStatus(label) {
    if (label === loaderLabel) return;
    const w = $('#loader-words'); w.classList.remove('roll');
    w.replaceChildren(...(loaderLabel ? [loaderLabel, label] : [label]).map((t) => h('span', { class: 'loader-word' }, t)));
    if (loaderLabel) { void w.offsetWidth; w.classList.add('roll'); }
    loaderLabel = label;
  }
  function renderTerminal(entry) {
    const body = $('#term-body'); const near = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    $('#term-user').textContent = `aura@supabase: ~/${entry ? entry.id.slice(0, 8) : ''}`;
    const lines = entry ? entry.state.log.slice(entry.logFrom) : [];
    const prompt = h('div', { class: 'term-prompt' }, h('span', { class: 'term-u' }, 'aura@supabase:'), h('span', { class: 'term-loc' }, '~'), h('span', { class: 'term-bling' }, '$'), h('span', { class: 'term-cursor' }));
    body.replaceChildren(...lines.map((l) => h('div', { class: 'term-line ' + l.kind }, h('span', { class: 'term-time' }, new Date(l.at).toLocaleTimeString()), h('span', { class: 'term-text' }, l.text))), prompt);
    if (near) body.scrollTop = body.scrollHeight;
  }
  function updateActivity() {
    const entry = currentId ? latestTask(currentId) : null; const t = entry && entry.state;
    $('#act-empty').hidden = Boolean(t); $('#act-task').hidden = !t;
    const on = Boolean(t) && store.isActive(t);
    $('#chat-glow').classList.toggle('busy', on); $('#working').hidden = !on;
    renderTerminal(entry);
    if (!t) return;
    const label = store.STATUS_ES[t.status] || t.status;
    const pill = $('#act-status'); pill.textContent = label; pill.dataset.state = t.status;
    if (on) setLoaderStatus(label);
    $('#act-agent').textContent = t.agent ? `${t.agent.name} · ${t.agent.model}` : '—';
    $('#act-handoffs').textContent = String(t.handoffs);
    fill('#act-files', t.files, 'Ninguno todavía');
    fill('#act-errors', t.errors.map((e) => `${e.kind}: ${e.message}`), 'Sin errores');
    $('#cost-rep').textContent = `$${t.usage.reported.toFixed(4)}`;
    $('#cost-est').textContent = `$${t.usage.estimated.toFixed(4)}`;
    $('#cost-unk').textContent = String(t.usage.unknownCalls);
    $('#authz').hidden = t.status !== 'awaiting_authorization';
  }
  function updateStats() {
    const s = conversations.stats();
    $('#stat-convs').textContent = String(s.conversations); $('#stat-msgs').textContent = String(s.messages);
    $('#stat-projects').textContent = String(projectStore.list().length);
    const kb = A.storage.usedBytes(localStorage) / 1024; $('#stat-storage').textContent = kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }
  function updateUsage() {
    const tot = { rep: 0, est: 0, unk: 0 };
    for (const e of tasks.values()) { tot.rep += e.state.usage.reported; tot.est += e.state.usage.estimated; tot.unk += e.state.usage.unknownCalls; }
    $('#sess-rep').textContent = `$${tot.rep.toFixed(4)}`; $('#sess-est').textContent = `$${tot.est.toFixed(4)}`; $('#sess-unk').textContent = String(tot.unk);
    updateStats();
  }
  async function authorize(approve) {
    const entry = currentId && latestTask(currentId); if (!entry) return;
    try { await api.authorize(entry.id, approve); toast(approve ? 'Autorizado' : 'Rechazado'); startPolling(); }
    catch (e) { toast(`No se pudo enviar: ${e.message}`); }
  }
  async function stopTask() {
    const entry = currentId && latestTask(currentId); if (!entry || !store.isActive(entry.state)) return;
    try { await api.cancelTask(entry.id); toast('Se ha pedido detener la tarea'); startPolling(); }
    catch (e) { toast(`No se pudo detener: ${e.message}`); }
  }

  function setupTabs(listSel, attr, onChange) {
    const tabs = [...document.querySelectorAll(`${listSel} [role="tab"]`)];
    function select(name) {
      tabs.forEach((t) => { const on = t.dataset[attr] === name; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; $('#' + t.getAttribute('aria-controls')).hidden = !on; });
      onChange && onChange(name);
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t.dataset[attr]));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); select(n.dataset[attr]);
      });
    });
    return select;
  }

  /* ---------- adjuntos ---------- */
  const MAX_FILES = 5, MAX_BYTES = 200 * 1024;
  const TEXT_EXT = /\.(txt|md|json|csv|js|ts|jsx|tsx|html|css|py|sql|yml|yaml|xml|sh|java|go|rs|php|rb|c|cpp|h|toml|ini|env\.example)$/i;
  function renderAttachments() {
    $('#attach-list').replaceChildren(...attachments.map((a, i) => h('span', { class: 'attach-chip' }, `${a.name} · ${Math.ceil(a.size / 1024)} KB`,
      h('button', { type: 'button', 'aria-label': `Quitar ${a.name}`, onclick: () => { attachments.splice(i, 1); renderAttachments(); updateTokens(); } }, icon('x', 12)))));
    updateTokens();
  }
  async function addFiles(fileList) {
    for (const f of fileList) {
      if (attachments.length >= MAX_FILES) { toast(`Máximo ${MAX_FILES} archivos`); break; }
      if (f.size > MAX_BYTES) { toast(`${f.name} supera 200 KB`); continue; }
      if (!(f.type.startsWith('text/') || f.type === 'application/json' || TEXT_EXT.test(f.name))) { toast(`${f.name}: solo archivos de texto o código`); continue; }
      try { attachments.push({ name: f.name, size: f.size, content: await f.text() }); } catch { toast(`No se pudo leer ${f.name}`); }
    }
    renderAttachments();
  }

  /* ---------- compositor ---------- */
  function autoGrow() { const i = $('#chat-input'); i.style.height = '56px'; i.style.height = Math.min(i.scrollHeight, 200) + 'px'; }
  function updateTokens() {
    const chars = $('#chat-input').value.length + attachments.reduce((n, a) => n + a.content.length, 0);
    const el = $('#token-est'); el.hidden = chars === 0;
    const n = Math.ceil(chars / 4); el.textContent = `≈ ${n.toLocaleString('es-ES')} ${n === 1 ? 'token' : 'tokens'}`; el.title = 'Estimación aproximada (1 token ≈ 4 caracteres). El recuento real lo informa el proveedor.';
  }
  function useTemplate(tpl) {
    if (!tpl) return;
    const input = $('#chat-input'); input.value = tpl.text; autoGrow(); updateTokens(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); closeSlash();
  }

  function closeSlash() { $('#slash-menu').hidden = true; slashItems = []; $('#chat-input').setAttribute('aria-expanded', 'false'); }
  function paintSlash() {
    const m = $('#slash-menu'); m.replaceChildren(...slashItems.map((c, i) => {
      const b = h('button', { type: 'button', role: 'option', class: 'slash-item' + (i === slashIndex ? ' active' : ''), 'aria-selected': String(i === slashIndex) },
        h('span', { class: 'slash-cmd' }, '/' + c.cmd), h('span', { class: 'slash-title' }, c.title), h('span', { class: 'slash-desc' }, c.desc));
      b.addEventListener('mousedown', (e) => { e.preventDefault(); useTemplate(c); });
      return b;
    }));
    m.hidden = !slashItems.length; $('#chat-input').setAttribute('aria-expanded', String(slashItems.length > 0));
    const act = m.querySelector('.active'); if (act) act.scrollIntoView({ block: 'nearest' });
  }
  function updateSlash() {
    const v = $('#chat-input').value;
    if (/^\/[\wáéíóúñ]*$/i.test(v)) { slashItems = prompts.filterSlash(v); slashIndex = 0; paintSlash(); } else closeSlash();
  }
  function openSlashFromButton() { const i = $('#chat-input'); if (!i.value) i.value = '/'; i.focus(); autoGrow(); updateSlash(); }

  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const btn = $('#mic-btn');
    if (!SR) return; btn.hidden = false;
    btn.addEventListener('click', () => {
      if (recognition) { recognition.stop(); return; }
      const input = $('#chat-input'); const base = input.value ? input.value.replace(/\s*$/, ' ') : '';
      recognition = new SR(); recognition.lang = 'es-ES'; recognition.interimResults = true; recognition.continuous = true;
      recognition.onresult = (e) => { let t = ''; for (const r of e.results) t += r[0].transcript; input.value = base + t; autoGrow(); updateTokens(); };
      recognition.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Voz: ${e.error === 'not-allowed' ? 'permiso de micrófono denegado' : e.error}`); };
      recognition.onend = () => { recognition = null; btn.classList.remove('recording'); btn.setAttribute('aria-pressed', 'false'); };
      try { recognition.start(); btn.classList.add('recording'); btn.setAttribute('aria-pressed', 'true'); } catch { recognition = null; }
    });
  }

  /* ---------- conectores MCP ---------- */
  function switchEl(checked, onChange, label) {
    const input = h('input', { type: 'checkbox', checked, 'aria-label': label });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, input, h('span', { class: 'slider' }));
  }
  function renderServers() {
    const list = servers.list(); const ul = $('#mcp-list');
    ul.replaceChildren(...list.map((s) => h('li', { class: 'mcp-item' },
      h('button', { class: 'mcp-info', type: 'button', onclick: () => openServer(s.id) }, h('span', { class: 'mcp-name' }, s.name), h('span', { class: 'mcp-meta' }, s.tools ? `${s.tools.length} herramientas` : 'Herramientas sin consultar')),
      switchEl(s.enabled, (on) => { servers.toggle(s.id, on); renderServers(); }, `Activar ${s.name}`))));
    if (!list.length) ul.append(h('li', { class: 'hint' }, 'Sin conectores todavía.'));
    $('#mcp-count').textContent = String(servers.enabledForTask().length);
  }
  async function inspect(id) {
    const s = servers.get(id); if (!s) return;
    if (!(await checkBackend())) { toast('Conecta Supabase para consultar las herramientas del servidor'); return; }
    try {
      const r = await api.mcpInspect(s.url); servers.setTools(id, r && r.tools); renderServers();
      toast(`${s.name}: ${(servers.get(id).tools || []).length} herramientas`); if ($('#mcp-detail').open) openServer(id);
    } catch (e) { toast(`No se pudieron consultar las herramientas: ${e.message}`); }
  }
  function openServer(id) {
    const s = servers.get(id); if (!s) return;
    $('#mcp-detail-name').textContent = s.name; $('#mcp-detail-url').textContent = s.url;
    $('#mcp-tools').replaceChildren(...(s.tools && s.tools.length
      ? s.tools.map((t) => h('li', null, h('strong', null, t.name), t.description || 'Sin descripción'))
      : [h('li', { class: 'muted' }, s.tools ? 'Este servidor no expone herramientas.' : 'Aún no se han consultado. Pulsa «Consultar herramientas».')]));
    $('#mcp-inspect').onclick = () => inspect(id);
    $('#mcp-remove').onclick = async () => {
      if (!(await ui.ask({ title: 'Eliminar conector', message: `¿Eliminar el conector «${s.name}»?`, confirmText: 'Eliminar', danger: true }))) return;
      servers.remove(id); renderServers(); $('#mcp-detail').close();
    };
    if (!$('#mcp-detail').open) $('#mcp-detail').showModal();
  }
  function openMcpAdd() { $('#mcp-form').reset(); $('#mcp-error').textContent = ''; $('#mcp-add').showModal(); $('#mcp-name').focus(); }

  /* ---------- agentes ---------- */
  function renderAgents() {
    $('#agents-auto').checked = prefs.agentsAuto;
    $('#agents-list').replaceChildren(...prompts.AGENTS.map((a) => {
      const input = h('input', { type: 'checkbox', checked: prefs.agents.includes(a.id), disabled: prefs.agentsAuto, 'aria-label': a.name });
      input.addEventListener('change', () => { prefs.agents = input.checked ? [...new Set([...prefs.agents, a.id])] : prefs.agents.filter((x) => x !== a.id); savePrefs(); updateChips(); });
      return h('label', { class: 'agent-row' + (prefs.agentsAuto ? ' off' : '') }, input,
        h('span', { class: 'checkmark' }, icon('check', 14)), h('span', { class: 'agent-text' }, h('strong', null, a.name), h('small', null, a.desc)));
    }));
  }
  function updateChips() {
    $('#agents-label').textContent = prompts.agentSummary(prefs);
    $('#tier-select').value = prefs.tier;
  }

  /* ---------- proyectos (diálogo) ---------- */
  function renderProjectsDialog() {
    const list = projectStore.list(); const ul = $('#proj-list');
    ul.replaceChildren(...list.map((p) => {
      const n = conversations.all().filter((c) => c.projectId === p.id).length;
      return h('li', { class: 'proj-row' },
        h('div', { class: 'proj-info' }, h('strong', null, p.name), h('span', null, `${n} conversaciones${p.instructions ? ' · con instrucciones' : ''}`)),
        h('div', { class: 'code-row-actions' },
          h('button', { class: 'act-btn', type: 'button', title: 'Editar', 'aria-label': `Editar ${p.name}`, onclick: () => editProject(p.id) }, icon('edit', 15)),
          h('button', { class: 'act-btn', type: 'button', title: 'Eliminar', 'aria-label': `Eliminar ${p.name}`, onclick: () => removeProject(p.id) }, icon('trash', 15))));
    }));
    if (!list.length) ul.append(h('li', { class: 'hint' }, 'Aún no tienes proyectos. Crea uno para agrupar conversaciones y darles instrucciones propias.'));
  }
  function editProject(id) {
    const p = projectStore.get(id); if (!p) return;
    $('#proj-id').value = p.id; $('#proj-name').value = p.name; $('#proj-instr').value = p.instructions; $('#proj-save').querySelector('.text').textContent = 'Guardar cambios'; $('#proj-reset').hidden = false; $('#proj-name').focus();
  }
  function resetProjectForm() { $('#proj-form').reset(); $('#proj-id').value = ''; $('#proj-error').textContent = ''; $('#proj-save').querySelector('.text').textContent = 'Crear proyecto'; $('#proj-reset').hidden = true; }
  async function removeProject(id) {
    const p = projectStore.get(id); if (!p) return;
    if (!(await ui.ask({ title: 'Eliminar proyecto', message: `Se eliminará «${p.name}». Sus conversaciones se conservan, pero sin proyecto.`, confirmText: 'Eliminar', danger: true }))) return;
    projectStore.remove(id); conversations.clearProject(id); resetProjectForm(); renderProjectsDialog(); renderProjectFilter(); renderConvList(); updateTitle(); updateStats();
  }
  function openProjects() { resetProjectForm(); renderProjectsDialog(); $('#projects-dialog').showModal(); }

  /* ---------- configuración ---------- */
  let selectSettingsTab = () => {};
  function openSettings(tab = 'conn') {
    const c = api.loadConfig();
    $('#cfg-url').value = c.baseUrl || ''; $('#cfg-token').value = c.token || ''; $('#cfg-fn').value = c.fn || '';
    $('#pref-confirm').checked = prefs.confirmDestructive; $('#pref-review').checked = prefs.reviewAgents; $('#pref-web').checked = prefs.webSearch;
    $('#pref-auto').checked = prefs.autonomous; $('#pref-notify').checked = prefs.notify; $('#pref-budget').value = prefs.budgetUsd; $('#pref-rounds').value = prefs.maxReviewRounds;
    $('#pref-instr').value = prefs.instructions; $('#instr-count').textContent = String(prefs.instructions.length);
    document.querySelector(`input[name="theme"][value="${prefs.theme}"]`).checked = true;
    $('#settings-error').textContent = ''; $('#test-result').textContent = ''; $('#test-result').dataset.ok = '';
    selectSettingsTab(tab); if (!$('#settings').open) $('#settings').showModal();
  }
  function readConn() { return { baseUrl: api.normalizeUrl($('#cfg-url').value), token: $('#cfg-token').value.trim(), fn: api.normalizeFn($('#cfg-fn').value) }; }
  function validateConn(c) {
    if (!c.baseUrl && !c.token) return null; // permitido: seguir sin backend
    return api.validateBaseUrl(c.baseUrl) || api.checkKey(c.token);
  }
  async function testConnection() {
    const out = $('#test-result'); const c = readConn(); const err = validateConn(c) || (!c.baseUrl ? 'Rellena la URL y la clave' : null);
    if (err) { out.textContent = err; out.dataset.ok = 'false'; return; }
    const prev = api.loadConfig(); api.saveConfig({ ...prev, ...c });
    out.textContent = 'Probando…'; out.dataset.ok = '';
    try { const ms = await api.ping(); out.textContent = `Conexión correcta · ${ms} ms`; out.dataset.ok = 'true'; setConn(true); $('#setup').hidden = true; }
    catch (e) { out.textContent = `No se pudo conectar: ${e.message}. Comprueba la URL, la clave y que la función «${c.fn}» esté desplegada con CORS.`; out.dataset.ok = 'false'; setConn(false, e.message); }
  }
  async function saveSettings() {
    const c = readConn(); const err = validateConn(c);
    if (err) { $('#settings-error').textContent = err; selectSettingsTab('conn'); return; }
    api.saveConfig(c);
    const theme = document.querySelector('input[name="theme"]:checked');
    const rounds = Math.min(5, Math.max(1, parseInt($('#pref-rounds').value, 10) || 2));
    prefs = { ...prefs, confirmDestructive: $('#pref-confirm').checked, reviewAgents: $('#pref-review').checked, webSearch: $('#pref-web').checked,
      autonomous: $('#pref-auto').checked, notify: $('#pref-notify').checked, budgetUsd: $('#pref-budget').value, maxReviewRounds: rounds,
      instructions: $('#pref-instr').value.slice(0, 2000), theme: theme ? theme.value : prefs.theme };
    if (prefs.notify && 'Notification' in window && Notification.permission === 'default') {
      if ((await Notification.requestPermission()) !== 'granted') { prefs.notify = false; toast('Permiso de avisos denegado'); }
    }
    savePrefs(); applyTheme(); $('#settings').close(); toast('Configuración guardada');
    if (!currentConv() || !currentConv().messages.length) renderMessages();
    resume();
  }
  async function wipeData() {
    if (!(await ui.ask({ title: 'Borrar todos mis datos', message: 'Se eliminarán conversaciones, proyectos, conectores, ajustes y la conexión con Supabase guardados en este navegador. No se puede deshacer.', confirmText: 'Borrar todo', danger: true }))) return;
    A.storage.clearAll(localStorage); location.reload();
  }

  /* ---------- paleta de comandos ---------- */
  function paletteItems(q) {
    const M = A.palette.matches; const acts = [
      { icon: 'plus', title: 'Nueva conversación', hint: 'Alt N', run: newConversation },
      { icon: 'gear', title: 'Abrir configuración', run: () => openSettings('conn') },
      { icon: 'plug', title: 'Probar conexión con Supabase', run: () => { openSettings('conn'); testConnection(); } },
      { icon: 'users', title: 'Elegir agentes especializados', run: () => { renderAgents(); $('#agents-dialog').showModal(); } },
      { icon: 'folder', title: 'Gestionar proyectos', run: openProjects },
      { icon: 'plus', title: 'Añadir conector MCP', run: openMcpAdd },
      { icon: 'sun', title: 'Cambiar tema (oscuro / claro / sistema)', run: cycleTheme },
      { icon: 'download', title: 'Exportar conversación (JSON)', run: exportJSON },
      { icon: 'download', title: 'Exportar conversación (Markdown)', run: () => exportMarkdown() },
      { icon: 'archive', title: 'Descargar copia de seguridad', run: downloadBackup },
      { icon: 'keyboard', title: 'Ver atajos de teclado', hint: '?', run: () => $('#shortcuts-dialog').showModal() },
      { icon: 'sidebar', title: 'Mostrar u ocultar la barra lateral', hint: 'Alt B', run: toggleSidebar },
      { icon: 'activity', title: 'Mostrar u ocultar la actividad', hint: 'Alt J', run: toggleActivity },
    ];
    if (busy()) acts.unshift({ icon: 'stop', title: 'Detener la tarea en curso', run: stopTask });
    const out = acts.filter((a) => !q.trim() || M(a.title, q)).map((a) => ({ group: 'Acciones', ...a }));
    for (const p of projectStore.list()) if (q.trim() && M(p.name, q)) out.push({ group: 'Proyectos', icon: 'folder', title: p.name, hint: 'Filtrar', run: () => { filterProject = p.id; renderProjectFilter(); renderConvList(); } });
    for (const c of conversations.list({ query: q }).slice(0, q.trim() ? 12 : 6)) {
      const p = c.projectId ? projectStore.get(c.projectId) : null;
      out.push({ group: 'Conversaciones', icon: 'code', title: c.title, hint: p ? p.name : new Date(c.updatedAt).toLocaleDateString('es-ES'), run: () => openConversation(c.id) });
    }
    return out;
  }

  /* ---------- paneles ---------- */
  function closeDrawers() { $('#sidebar').classList.remove('open'); $('#activity').classList.remove('open'); $('#scrim').classList.remove('show'); }
  function toggleSidebar() {
    if (isNarrowSide()) { const on = !$('#sidebar').classList.contains('open'); closeDrawers(); $('#sidebar').classList.toggle('open', on); $('#scrim').classList.toggle('show', on); }
    else { prefs.sidebarCollapsed = !document.body.classList.contains('side-collapsed'); document.body.classList.toggle('side-collapsed', prefs.sidebarCollapsed); savePrefs(); }
  }
  function toggleActivity() {
    if (isNarrowAct()) { const on = !$('#activity').classList.contains('open'); closeDrawers(); $('#activity').classList.toggle('open', on); $('#scrim').classList.toggle('show', on); }
    else document.body.classList.toggle('act-hidden');
  }

  /* ---------- arranque ---------- */
  function init() {
    applyTheme();
    document.body.classList.toggle('side-collapsed', Boolean(prefs.sidebarCollapsed) && !isNarrowSide());
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

    $('#chat-glow').addEventListener('submit', (e) => { e.preventDefault(); send(); });
    const input = $('#chat-input');
    input.addEventListener('keydown', (e) => {
      if (!$('#slash-menu').hidden) {
        if (e.key === 'ArrowDown') { e.preventDefault(); slashIndex = (slashIndex + 1) % slashItems.length; paintSlash(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); slashIndex = (slashIndex - 1 + slashItems.length) % slashItems.length; paintSlash(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); useTemplate(slashItems[slashIndex]); return; }
        if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    input.addEventListener('input', () => { autoGrow(); updateTokens(); updateSlash(); });
    input.addEventListener('blur', () => setTimeout(closeSlash, 120));
    input.addEventListener('paste', (e) => { const f = e.clipboardData && e.clipboardData.files; if (f && f.length) { e.preventDefault(); addFiles([...f]); } });
    $('#attach-btn').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
    $('#slash-btn').addEventListener('click', openSlashFromButton);
    $('#chip-agents').addEventListener('click', () => { renderAgents(); $('#agents-dialog').showModal(); });
    $('#tier-select').addEventListener('change', (e) => { prefs.tier = e.target.value; savePrefs(); toast(`Nivel de modelo: ${e.target.selectedOptions[0].textContent}`); });
    setupVoice();

    let dragDepth = 0; const chat = $('.chat');
    chat.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { dragDepth++; $('#drop-overlay').hidden = false; } });
    chat.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').hidden = true; });
    chat.addEventListener('dragover', (e) => e.preventDefault());
    chat.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true; if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });

    $('#new-chat').addEventListener('click', newConversation);
    $('#conv-search').addEventListener('input', renderConvList);
    $('#project-filter').addEventListener('change', (e) => { filterProject = e.target.value; showArchived = false; renderConvList(); });
    $('#manage-projects').addEventListener('click', openProjects);
    $('#toggle-archived').addEventListener('click', () => { showArchived = !showArchived; renderConvList(); });
    $('#stop-btn').addEventListener('click', stopTask);
    $('#authz-yes').addEventListener('click', () => authorize(true));
    $('#authz-no').addEventListener('click', () => authorize(false));
    $('#term-clear').addEventListener('click', () => { const e = currentId && latestTask(currentId); if (e) { e.logFrom = e.state.log.length; updateActivity(); } });
    $('#export-input').addEventListener('change', (e) => { if (!e.target.checked) return; if (!exportJSON()) { e.target.checked = false; return; } setTimeout(() => { e.target.checked = false; }, 5000); });
    $('#export-md').addEventListener('click', () => exportMarkdown());
    $('#backup-download').addEventListener('click', downloadBackup);

    setupTabs('#activity-tabs', 'tab', (name) => { if (name === 'usage') updateUsage(); });
    selectSettingsTab = setupTabs('#settings-tabs', 'stab');

    $('#open-settings').addEventListener('click', () => openSettings('conn'));
    $('#open-settings-2').addEventListener('click', () => openSettings('conn'));
    $('#conn').addEventListener('click', () => openSettings('conn'));
    $('#settings-form').addEventListener('submit', (e) => { e.preventDefault(); if (e.submitter && e.submitter.value === 'cancel') { $('#settings').close(); return; } saveSettings(); });
    $('#test-conn').addEventListener('click', testConnection);
    $('#pref-instr').addEventListener('input', (e) => { $('#instr-count').textContent = String(e.target.value.length); });
    $('#backup-export').addEventListener('click', downloadBackup);
    $('#backup-import-btn').addEventListener('click', () => $('#backup-import').click());
    $('#backup-import').addEventListener('change', (e) => { importBackupFile(e.target.files[0]); e.target.value = ''; });
    $('#wipe-data').addEventListener('click', wipeData);

    $('#agents-auto').addEventListener('change', (e) => { prefs.agentsAuto = e.target.checked; savePrefs(); renderAgents(); updateChips(); });
    $('#proj-form').addEventListener('submit', (e) => {
      e.preventDefault(); const id = $('#proj-id').value;
      try {
        const data = { name: $('#proj-name').value, instructions: $('#proj-instr').value };
        const p = id ? projectStore.update(id, data) : projectStore.add(data);
        resetProjectForm(); renderProjectsDialog(); renderProjectFilter(); renderConvList(); updateTitle(); updateStats(); toast(id ? 'Proyecto actualizado' : `Proyecto «${p.name}» creado`);
      } catch (err) { $('#proj-error').textContent = err.message; }
    });
    $('#proj-reset').addEventListener('click', resetProjectForm);

    $('#add-mcp').addEventListener('click', openMcpAdd);
    $('#mcp-form').addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      try { const s = servers.add({ name: $('#mcp-name').value, url: $('#mcp-url').value }); $('#mcp-add').close(); renderServers(); toast(`Conector «${s.name}» añadido`); if (api.isConfigured()) inspect(s.id); }
      catch (err) { $('#mcp-error').textContent = err.message; }
    });

    document.querySelectorAll('#preview-devices button').forEach((b) => b.addEventListener('click', () => setPreviewWidth(b.dataset.w)));
    $('#preview-download').addEventListener('click', () => previewBlock && downloadCode(previewBlock));
    $('#preview-dialog').addEventListener('close', () => { $('#preview-frame').srcdoc = ''; });

    const pal = A.palette.create({ getItems: paletteItems });
    $('#open-palette').addEventListener('click', pal.open);
    $('#toggle-sidebar').addEventListener('click', toggleSidebar);
    $('#toggle-activity').addEventListener('click', toggleActivity);
    $('#scrim').addEventListener('click', closeDrawers);
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d && d.id !== 'palette') d.close(); }));

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.open(); }
      else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newConversation(); }
      else if (e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
      else if (e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleActivity(); }
      else if (e.key === 'Escape') { closeDrawers(); }
      else if (!typing && !mod && e.key === '/') { e.preventDefault(); input.focus(); }
      else if (!typing && !mod && e.key === '?') { e.preventDefault(); $('#shortcuts-dialog').showModal(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
    window.addEventListener('offline', () => setConn(false, 'sin internet'));
    window.addEventListener('online', () => resume());

    try { if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch { /* navegador sin service workers */ }

    const recent = conversations.list()[0]; currentId = recent ? recent.id : null;
    renderProjectFilter(); renderConvList(); renderMessages(); renderServers(); renderAgents(); updateChips(); updateTitle(); updateActivity(); renderCodeTab(); updateUsage();
    resume();
  }

  init();
})();
