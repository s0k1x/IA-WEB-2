/* AURA-X · aplicación */
(function () {
  'use strict';
  const A = window.Aura;
  const { ui, supa, data, render, prompts } = A;
  const { $, $$, h, icon, toast } = ui;

  const DEFAULTS = { mode: 'auto', tier: 'balanced', instructions: '', agentsAuto: true, agents: [], reviewAgents: false, maxReviewRounds: 1, confirmDestructive: true, budgetUsd: '', notify: false, mcp: [] };
  const S = {
    settings: { ...DEFAULTS }, projects: [], convs: [], currentId: null, pendingProjectId: null,
    messages: [], tasks: [], live: null, seq: {}, events: {}, attachments: [], view: 'chat', projectViewId: null,
    query: '', contentHits: null, showArchived: false, runningConvs: new Set(), artifacts: [], artifactIndex: -1, artifactTab: 'preview', previewWidth: '100%',
    autoOpened: new Set(), pollTimer: null, bgTimer: null, health: null,
  };
  const ACTIVE = data.ACTIVE;
  const STATUS = { pending: 'En cola', analyzing: 'Analizando', planning: 'Planificando', executing: 'Construyendo', reviewing: 'Revisando', testing: 'Probando',
    interrupted: 'Continuando en segundo plano', awaiting_user: 'Esperando tu respuesta', awaiting_authorization: 'Esperando tu autorización', blocked: 'Detenida', completed: 'Completada', failed: 'No completada' };
  const prettyModel = (m) => !m ? '' : m.startsWith('claude-') ? 'Claude ' + m.slice(7).replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1').replace(/^\w/, (c) => c.toUpperCase()) : m.startsWith('gemini-') ? 'Gemini ' + m.slice(7).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : m;
  const conv = () => S.convs.find((c) => c.id === S.currentId) || null;
  const project = (id) => S.projects.find((p) => p.id === id) || null;
  const isNarrow = () => matchMedia('(max-width: 860px)').matches;
  const errMsg = (e) => (e && e.message) || 'Algo ha fallado';

  /* ------------------------------------------------------------ tema */
  function applyTheme() {
    const t = localStorage.getItem('aura.theme') || 'system';
    document.documentElement.dataset.theme = t;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#16191F' : '#F5F6F8';
  }
  function setTheme(t) { localStorage.setItem('aura.theme', t); applyTheme(); }

  /* ------------------------------------------------------------ acceso */
  function showAuth(step) {
    $('#app').hidden = true; $('#auth').hidden = false;
    $('#connect-form').hidden = step !== 'connect'; $('#auth-login').hidden = step !== 'login';
    $('#change-server').hidden = supa.preconfigured;
    $('#auth-error').textContent = ''; $('#auth-note').textContent = '';
    if (step === 'connect') {
      const c = supa.config || {}; $('#cx-url').value = c.url || ''; $('#cx-key').value = c.key || ''; $('#cx-fn').value = c.fn || 'aura'; $('#cx-url').focus();
    } else { $('#auth-server').textContent = (supa.config && supa.config.url.replace(/^https?:\/\//, '')) || ''; }
  }
  async function connect(e) {
    e.preventDefault();
    const url = supa.normalizeUrl($('#cx-url').value); const key = $('#cx-key').value.trim(); const fn = supa.normalizeFn($('#cx-fn').value);
    const err = supa.validateUrl(url) || supa.checkKey(key); if (err) { $('#auth-error').textContent = err; return; }
    supa.setConfig({ url, key, fn });
    const btn = $('#cx-submit'); btn.disabled = true; $('#auth-error').textContent = '';
    try { await data.health(); showAuth('login'); }
    catch (er) { showAuth('login'); $('#auth-note').textContent = `Proyecto guardado. La función «${fn}» todavía no responde (${errMsg(er)}); puedes entrar igualmente.`; }
    finally { btn.disabled = false; }
  }
  async function signOut() {
    stopPolling(); clearInterval(S.bgTimer);
    await supa.signOut();
    Object.assign(S, { convs: [], projects: [], messages: [], tasks: [], currentId: null, live: null });
    showAuth('login');
  }

  async function enterApp() {
    $('#auth').hidden = true; $('#app').hidden = false;
    const u = supa.user || {}; $('#user-email').textContent = u.email || ''; $('#user-initial').textContent = (u.email || '?').slice(0, 1).toUpperCase();
    try { S.settings = { ...DEFAULTS, ...(await data.loadSettings()) }; } catch (e) { toast(`No se pudieron cargar tus ajustes: ${errMsg(e)}`, 'error'); }
    applyComposerSettings();
    await Promise.all([loadProjects(), loadConvs()]);
    newChat();
    checkHealth(); bgCheck(); clearInterval(S.bgTimer); S.bgTimer = setInterval(bgCheck, 15000);
  }
  async function checkHealth() {
    try { S.health = await data.health(); setStatus(true); }
    catch (e) { S.health = null; setStatus(false, errMsg(e)); }
  }
  function setStatus(ok, detail) {
    const b = $('#status-dot'); b.dataset.ok = String(ok);
    b.title = ok ? (S.health && (!S.health.claude || !S.health.gemini) ? `Conectado. Falta configurar: ${[!S.health.gemini && 'Gemini', !S.health.claude && 'Claude'].filter(Boolean).join(' y ')}` : 'Conectado') : `Sin conexión con la función: ${detail}`;
    $('#status-text').textContent = ok ? (S.health && (!S.health.claude || !S.health.gemini) ? 'Configuración incompleta' : '') : 'Sin conexión';
  }

  /* ------------------------------------------------------------ barra lateral */
  async function loadProjects() { try { S.projects = await data.projects(); } catch (e) { toast(errMsg(e), 'error'); } }
  async function loadConvs() { try { S.convs = await data.conversations(); renderSidebar(); } catch (e) { toast(errMsg(e), 'error'); } }

  function convItem(c) {
    const li = h('li', { class: 'conv-item' + (c.id === S.currentId && S.view === 'chat' ? ' active' : '') });
    const open = h('button', { class: 'conv-open', type: 'button', title: c.title, onclick: () => openConv(c.id) },
      h('span', { class: 'conv-title' }, c.title), S.runningConvs.has(c.id) ? h('span', { class: 'conv-running', title: 'Trabajando' }) : null);
    const more = h('button', { class: 'conv-more', type: 'button', 'aria-label': `Opciones de «${c.title}»` }, icon('more', 16));
    more.addEventListener('click', (e) => { e.stopPropagation(); convMenu(more, c); });
    open.addEventListener('contextmenu', (e) => { e.preventDefault(); convMenu(more, c); });
    li.append(open, more); return li;
  }
  function renderSidebar() {
    const q = ui.norm(S.query);
    const list = S.convs.filter((c) => c.archived === S.showArchived).filter((c) => !q || ui.norm(c.title).includes(q) || (S.contentHits && S.contentHits.includes(c.id)));
    const box = $('#conv-list'); box.replaceChildren();
    const groups = S.showArchived ? (list.length ? [{ label: 'Archivadas', items: list }] : []) : ui.groupByDate(list);
    for (const g of groups) box.append(h('p', { class: 'group-label' }, g.label), h('ul', { class: 'conv-list' }, g.items.map(convItem)));
    if (!groups.length) box.append(h('p', { class: 'side-empty' }, q ? 'No hay conversaciones que coincidan.' : S.showArchived ? 'No hay conversaciones archivadas.' : 'Tus conversaciones aparecerán aquí.'));
    const nArch = S.convs.filter((c) => c.archived).length; const t = $('#toggle-archived');
    t.hidden = !nArch && !S.showArchived; t.textContent = S.showArchived ? 'Volver a las conversaciones' : `Archivadas (${nArch})`;
    $('#nav-projects').classList.toggle('active', S.view !== 'chat');
  }
  function convMenu(anchor, c) {
    const items = [
      { label: 'Renombrar', icon: 'edit', run: () => renameConv(c) },
      { label: c.pinned ? 'Quitar de fijadas' : 'Fijar', icon: 'pin', run: () => patchConv(c, { pinned: !c.pinned }) },
      { label: c.archived ? 'Desarchivar' : 'Archivar', icon: 'archive', run: async () => { await patchConv(c, { archived: !c.archived, pinned: false }); if (c.id === S.currentId && !c.archived) newChat(); } },
    ];
    if (S.projects.length) items.push({ separator: true }, { heading: true, label: 'Mover a proyecto' },
      ...S.projects.map((p) => ({ label: p.name, icon: 'folder', disabled: c.project_id === p.id, run: () => patchConv(c, { project_id: p.id }) })),
      { label: 'Sin proyecto', icon: 'x', disabled: !c.project_id, run: () => patchConv(c, { project_id: null }) });
    items.push({ separator: true }, { label: 'Exportar en Markdown', icon: 'download', run: () => exportMarkdown(c) }, { label: 'Eliminar', icon: 'trash', danger: true, run: () => deleteConv(c) });
    ui.menu(anchor, items);
  }
  async function patchConv(c, patch) {
    try { await data.updateConversation(c.id, patch); Object.assign(c, patch); renderSidebar(); renderTopbar(); }
    catch (e) { toast(errMsg(e), 'error'); }
  }
  function renameConv(c) {
    const t = $('#chat-title'); if (c.id !== S.currentId) { openConv(c.id).then(() => renameConv(conv())); return; }
    const input = h('input', { class: 'title-input', value: c.title, maxLength: 120, 'aria-label': 'Título de la conversación' });
    t.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = async (save) => { if (done) return; done = true; input.replaceWith(t); if (save && input.value.trim() && input.value.trim() !== c.title) await patchConv(c, { title: input.value.trim().slice(0, 120) }); renderTopbar(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  }
  async function deleteConv(c) {
    if (!(await ui.ask({ title: 'Eliminar conversación', message: `Se borrará «${c.title}» con todos sus mensajes. No se puede deshacer.`, confirmText: 'Eliminar', danger: true }))) return;
    try { await data.deleteConversation(c.id); S.convs = S.convs.filter((x) => x.id !== c.id); if (S.currentId === c.id) newChat(); renderSidebar(); toast('Conversación eliminada'); }
    catch (e) { toast(errMsg(e), 'error'); }
  }
  let searchTimer;
  function onSearch(e) {
    S.query = e.target.value; S.contentHits = null; renderSidebar();
    clearTimeout(searchTimer);
    if (S.query.trim().length >= 3) searchTimer = setTimeout(async () => { try { S.contentHits = await data.searchContent(S.query); renderSidebar(); } catch { /* sin búsqueda en contenido */ } }, 350);
  }

  /* ------------------------------------------------------------ vistas */
  function showView(v) {
    S.view = v; $('#view-chat').hidden = v !== 'chat'; $('#view-projects').hidden = v !== 'projects'; $('#view-project').hidden = v !== 'project';
    renderSidebar(); renderTopbar(); if (v !== 'chat') closeArtifact();
    if (isNarrow()) closeDrawer();
  }
  function renderTopbar() {
    const c = conv();
    const title = S.view === 'projects' ? 'Proyectos' : S.view === 'project' ? (project(S.projectViewId) || {}).name || 'Proyecto' : c ? c.title : 'Nueva conversación';
    $('#chat-title').textContent = title; $('#chat-title').disabled = !(S.view === 'chat' && c);
    const pid = S.view === 'chat' ? (c ? c.project_id : S.pendingProjectId) : null; const p = pid && project(pid);
    const chip = $('#chat-project'); chip.hidden = !p; chip.textContent = p ? p.name : '';
    document.title = S.view === 'chat' && c ? `${c.title} · AURA-X` : 'AURA-X';
    const n = S.artifacts.length; const b = $('#toggle-artifacts'); b.hidden = S.view !== 'chat' || !n; $('#artifact-count').textContent = String(n);
    $('#conv-actions').hidden = !(S.view === 'chat' && c);
  }

  /* ------------------------------------------------------------ conversación */
  function newChat(projectId = null) {
    stopPolling(); S.currentId = null; S.pendingProjectId = projectId; S.messages = []; S.tasks = []; S.live = null; S.artifacts = []; S.artifactIndex = -1;
    showView('chat'); renderMessages(); updateComposer(); closeArtifact(); $('#input').focus();
  }
  async function openConv(id) {
    stopPolling(); S.currentId = id; S.pendingProjectId = null; S.live = null; showView('chat');
    $('#messages').replaceChildren(h('div', { class: 'loading-line' }, 'Cargando…'));
    try { [S.messages, S.tasks] = await Promise.all([data.messages(id), data.tasks(id)]); }
    catch (e) { toast(errMsg(e), 'error'); S.messages = []; S.tasks = []; }
    if (S.currentId !== id) return;
    collectArtifacts(); renderMessages(); updateComposer(); renderTopbar();
    const running = [...S.tasks].reverse().find((t) => ACTIVE.includes(t.status));
    if (running) startLive(running);
    if (!isNarrow()) $('#input').focus();
  }
  async function reloadConv() { if (!S.currentId) return; try { [S.messages, S.tasks] = await Promise.all([data.messages(S.currentId), data.tasks(S.currentId)]); collectArtifacts(); renderMessages(); updateComposer(); renderTopbar(); } catch (e) { toast(errMsg(e), 'error'); } }
  const taskOf = (m) => S.tasks.find((t) => t.assistant_message_id === m.id) || (m.task_id && S.tasks.find((t) => t.id === m.task_id)) || null;
  const awaitingTask = () => [...S.tasks].reverse().find((t) => t.status === 'awaiting_user' || t.status === 'awaiting_authorization') || null;

  function greeting() {
    const hr = new Date().getHours(); const name = ((supa.user && supa.user.email) || '').split('@')[0];
    const g = hr < 6 ? 'Buenas noches' : hr < 13 ? 'Buenos días' : hr < 21 ? 'Buenas tardes' : 'Buenas noches';
    return name ? `${g}, ${name}` : g;
  }
  function emptyState() {
    const p = S.pendingProjectId && project(S.pendingProjectId);
    const ideas = [['plan', 'Planificar una aplicación'], ['seguridad', 'Revisar la seguridad'], ['bd', 'Diseñar una base de datos'], ['bug', 'Corregir un error']];
    const missing = S.health && [!S.health.gemini && 'Gemini', !S.health.claude && 'Claude'].filter(Boolean);
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-mark' }, ui.logo(44)),
      h('h1', null, greeting()),
      p ? h('p', { class: 'empty-sub' }, `Nueva conversación en el proyecto ${p.name}. Se aplicarán sus instrucciones.`) : h('p', { class: 'empty-sub' }, 'Describe lo que quieres construir. Gemini lo analiza y planifica, Claude lo construye.'),
      missing && missing.length ? h('p', { class: 'empty-warn' }, icon('alert', 15), `Falta la clave de ${missing.join(' y ')} en los secretos de Supabase. ${missing.includes('Claude') && !missing.includes('Gemini') ? 'Mientras tanto responderá Gemini.' : ''}`) : null,
      h('div', { class: 'starters' }, ideas.map(([cmd, label]) => h('button', { class: 'starter', type: 'button', onclick: () => useTemplate(prompts.SLASH.find((s) => s.cmd === cmd)) }, label))));
  }
  function renderMessages() {
    const box = $('#messages');
    if (!S.messages.length) { box.replaceChildren(emptyState()); return; }
    const lastAssistant = [...S.messages].reverse().find((m) => m.role === 'assistant');
    box.replaceChildren(...S.messages.map((m) => messageEl(m, m === lastAssistant)));
    box.scrollTop = box.scrollHeight;
  }

  function attachmentChip(a) {
    const kind = a.mime && a.mime.startsWith('image/') ? 'image' : 'file';
    return h('button', { class: 'att-chip', type: 'button', title: `${a.name} (${Math.ceil((a.size || 0) / 1024)} KB)`, onclick: () => openAttachment(a) }, icon(kind, 14), h('span', null, a.name));
  }
  async function openAttachment(a) {
    try {
      const blob = await supa.file(a.path);
      if (a.mime && a.mime.startsWith('image/')) { const url = URL.createObjectURL(blob); $('#image-view').src = url; $('#image-name').textContent = a.name; $('#image-dialog').showModal(); $('#image-dialog').addEventListener('close', () => URL.revokeObjectURL(url), { once: true }); }
      else ui.download(a.name, blob);
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  function actBtn(name, label, run) { return h('button', { class: 'act-btn', type: 'button', title: label, 'aria-label': label, onclick: run }, icon(name, 15)); }

  function messageEl(m, isLastAssistant) {
    const hooks = { onOpen: (b) => openArtifactFor(b), onDownload: downloadCode };
    if (m.role === 'user') {
      const actions = h('div', { class: 'msg-actions' }, actBtn('copy', 'Copiar', () => copyText(m.content)), actBtn('edit', 'Editar y reenviar', () => editMessage(m)), actBtn('trash', 'Borrar', () => deleteMessage(m)));
      return h('div', { class: 'msg user', dataset: { id: m.id } },
        h('div', { class: 'bubble' }, render.content(m.content || '')),
        (m.attachments || []).length ? h('div', { class: 'att-list' }, m.attachments.map(attachmentChip)) : null, actions);
    }
    if (m.role === 'system') return h('div', { class: 'msg system', dataset: { id: m.id } }, h('div', { class: 'bubble' }, m.content));
    const t = taskOf(m);
    const body = h('div', { class: 'msg-body' });
    if (t) body.append(processEl(t, m));
    const contentEl = h('div', { class: 'content' + (m.status === 'streaming' ? ' streaming' : '') + (m.status === 'error' ? ' error' : '') });
    if (m.content) contentEl.append(render.content(m.content, hooks));
    else if (m.status === 'streaming') contentEl.append(h('span', { class: 'thinking' }, STATUS[t && t.status] || 'Pensando'));
    body.append(contentEl);
    if (t && t.status === 'awaiting_authorization' && t.assistant_message_id === m.id) body.append(h('div', { class: 'authz' },
      h('p', null, 'Esta tarea necesita tu permiso para continuar.'),
      h('div', { class: 'authz-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => authorize(t, true) }, 'Aprobar y continuar'), h('button', { class: 'btn', type: 'button', onclick: () => authorize(t, false) }, 'Rechazar'))));
    if (m.status !== 'streaming') {
      const acts = h('div', { class: 'msg-actions' }, actBtn('copy', 'Copiar', () => copyText(m.content)));
      if (isLastAssistant && !awaitingTask()) acts.append(actBtn('refresh', 'Regenerar respuesta', () => regenerate(m)));
      acts.append(actBtn('trash', 'Borrar', () => deleteMessage(m)));
      if (m.model) acts.append(h('span', { class: 'msg-model' }, prettyModel(m.model)));
      body.append(acts);
    }
    return h('div', { class: 'msg assistant', dataset: { id: m.id } }, h('div', { class: 'avatar' }, ui.logo(20)), body);
  }

  // Bloque de proceso: etapas reales de la tarea (Analizar → Construir → Revisar)
  function processEl(t, m) {
    const evs = S.events[t.id] || []; const live = S.live && S.live.id === t.id;
    const stages = { analyze: 'pending', build: 'pending', review: null };
    let plan = (t.state && t.state.plan) || []; const notes = []; let usage = { input: 0, output: 0, cost: 0, unknown: 0, free: 0 };
    for (const e of evs) {
      const d = e.data || {};
      if (e.type === 'stage') stages[d.name] = d.status;
      else if (e.type === 'plan') plan = d.steps || plan;
      else if (e.type === 'handoff') notes.push({ kind: 'handoff', text: `Cambio de modelo: ${prettyModel(d.from)} no estaba disponible, continúa ${prettyModel(d.to)}.` });
      else if (e.type === 'tool') notes.push({ kind: 'tool', text: `Herramienta ${d.name}${d.server ? ` de ${d.server}` : ''}` });
      else if (e.type === 'review') notes.push({ kind: d.approved ? 'ok' : 'warn', text: d.approved ? `Revisión ${d.round}: aprobada` : `Revisión ${d.round}: ${(d.issues || []).join('; ')}` });
      else if (e.type === 'error') notes.push({ kind: 'error', text: d.message });
      else if (e.type === 'usage') { usage.input += d.inputTokens || 0; usage.output += d.outputTokens || 0; if (d.provenance === 'free') usage.free++; if (typeof d.costUsd === 'number') usage.cost += d.costUsd; else usage.unknown++; }
    }
    if (t.options && t.options.reviewAgents) stages.review = stages.review || 'pending';
    if (!evs.length) { const st = t.status; if (st === 'completed') { stages.analyze = t.mode === 'claude' ? 'skipped' : 'done'; stages.build = 'done'; if (stages.review) stages.review = 'done'; } }
    const statusText = STATUS[t.status] || t.status;
    const details = h('details', { class: 'process', open: live && ACTIVE.includes(t.status) ? true : null });
    details.addEventListener('toggle', () => { if (details.open && !S.events[t.id]) loadEvents(t).then(() => { const old = $(`.msg[data-id="${m.id}"]`); if (old) old.replaceWith(messageEl(m, old.querySelector('[aria-label="Regenerar respuesta"]') != null)); }); });
    const running = ACTIVE.includes(t.status);
    details.append(h('summary', null, h('span', { class: 'proc-status' + (running ? ' running' : '') }, statusText), plan.length ? h('span', { class: 'proc-meta' }, `Plan de ${plan.length} pasos`) : null, icon('chevron', 14)));
    const names = { analyze: 'Analizar y planificar', build: 'Construir', review: 'Revisar' };
    const rail = h('ol', { class: 'rail' });
    for (const k of ['analyze', 'build', 'review']) {
      if (!stages[k]) continue;
      const li = h('li', { class: 'rail-step ' + stages[k] }, h('span', { class: 'rail-dot' }), h('span', { class: 'rail-name' }, names[k]),
        stages[k] === 'skipped' ? h('span', { class: 'rail-note' }, 'omitido') : null);
      if (k === 'analyze' && plan.length) li.append(h('ol', { class: 'plan' }, plan.map((p) => h('li', null, p))));
      rail.append(li);
    }
    details.append(rail);
    if (notes.length) details.append(h('ul', { class: 'proc-notes' }, notes.map((n) => h('li', { class: n.kind }, n.text))));
    if (usage.input || usage.output) details.append(h('p', { class: 'proc-usage' }, `${(usage.input + usage.output).toLocaleString('es-ES')} tokens. `,
      usage.unknown ? 'Coste sin dato del proveedor.' : usage.cost ? `Coste estimado: $${usage.cost.toFixed(4)}.` : usage.free ? 'Gemini en plan gratuito: sin coste.' : ''));
    if (t.status === 'failed' && t.last_error && !notes.some((n) => n.kind === 'error')) details.append(h('p', { class: 'proc-error' }, t.last_error));
    return details;
  }
  async function loadEvents(t) { try { const ev = await data.events(t.id, 0); S.events[t.id] = ev; S.seq[t.id] = ev.length ? ev[ev.length - 1].seq : 0; } catch { S.events[t.id] = []; } }

  async function copyText(text) { try { await navigator.clipboard.writeText(String(text || '')); toast('Copiado'); } catch { toast('No se pudo copiar', 'error'); } }
  async function deleteMessage(m) {
    if (S.live) return toast('Espera a que termine la tarea o detenla');
    try { await data.deleteMessage(m.id); S.messages = S.messages.filter((x) => x.id !== m.id); collectArtifacts(); renderMessages(); renderTopbar(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function editMessage(m) {
    if (S.live) return toast('Espera a que termine la tarea o detenla');
    if (awaitingTask()) return toast('Responde o detén primero la tarea pendiente');
    try {
      await data.deleteFrom(S.currentId, m.created_at);
      if ((m.attachments || []).length) toast('Los adjuntos de ese mensaje no se recuperan: vuelve a añadirlos si los necesitas');
      await reloadConv(); const i = $('#input'); i.value = m.content || ''; autoGrow(); updateTokens(); i.focus();
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function regenerate(m) {
    if (S.live) return;
    const idx = S.messages.indexOf(m); let u = idx; while (u >= 0 && S.messages[u].role !== 'user') u--;
    if (u < 0) return toast('No hay un mensaje tuyo que reenviar');
    const userMsg = S.messages[u];
    try {
      await data.deleteFrom(S.currentId, S.messages[u + 1].created_at);
      const res = await data.createTask({ ...basePayload(), conversationId: S.currentId, userMessageId: userMsg.id });
      await afterCreate(res);
    } catch (e) { toast(errMsg(e), 'error'); reloadConv(); }
  }

  /* ------------------------------------------------------------ enviar */
  function basePayload() {
    const st = S.settings; const c = conv(); const p = project(c ? c.project_id : S.pendingProjectId);
    return {
      mode: st.mode, tier: st.tier,
      instructions: { global: st.instructions || null, project: p && p.instructions ? p.instructions : null, projectName: p ? p.name : null },
      options: { confirmDestructive: st.confirmDestructive, reviewAgents: st.reviewAgents, maxReviewRounds: Number(st.maxReviewRounds) || 1, budgetUsd: Number(st.budgetUsd) > 0 ? Number(st.budgetUsd) : null, agents: st.agentsAuto ? null : st.agents },
      mcpServers: st.mode === 'gemini' ? [] : (st.mcp || []).filter((s) => s.enabled).map(({ name, url }) => ({ name, url })),
    };
  }
  async function send() {
    const input = $('#input'); const text = input.value.trim();
    if (!text && !S.attachments.length) return;
    if (S.live) return stopTask();
    const waiting = awaitingTask();
    const btn = $('#send'); btn.disabled = true;
    try {
      if (waiting && waiting.status === 'awaiting_user') {
        if (S.attachments.length) toast('Los adjuntos no se envían al responder una pregunta');
        input.value = ''; autoGrow(); updateTokens();
        await data.answer(waiting.id, text); await reloadConv();
        const t = S.tasks.find((x) => x.id === waiting.id); if (t) startLive(t);
        return;
      }
      if (waiting) { toast('Aprueba o rechaza primero la tarea pendiente'); return; }
      const files = S.attachments; const payload = { ...basePayload(), conversationId: S.currentId, projectId: S.currentId ? null : S.pendingProjectId, prompt: text,
        attachments: await Promise.all(files.map(async (a) => ({ name: a.file.name, mime: a.mime, data: await ui.fileToBase64(a.file) }))) };
      // Vista inmediata mientras responde el servidor
      S.messages.push({ id: 'tmp-u', role: 'user', content: text, attachments: files.map((a) => ({ name: a.file.name, mime: a.mime, size: a.file.size })), created_at: new Date().toISOString() },
        { id: 'tmp-a', role: 'assistant', content: '', status: 'streaming', created_at: new Date().toISOString() });
      renderMessages(); input.value = ''; autoGrow(); clearAttachments(); updateTokens();
      const res = await data.createTask(payload);
      await afterCreate(res);
    } catch (e) {
      S.messages = S.messages.filter((m) => !String(m.id).startsWith('tmp-')); renderMessages();
      if (!input.value) input.value = text; autoGrow();
      toast(errMsg(e), 'error');
    } finally { btn.disabled = false; updateComposer(); }
  }
  async function afterCreate(res) {
    const isNew = res.conversationId !== S.currentId; S.currentId = res.conversationId;
    if (isNew) await loadConvs();
    else { const c = conv(); if (c) { c.updated_at = new Date().toISOString(); renderSidebar(); } }
    await reloadConv();
    const t = S.tasks.find((x) => x.id === res.taskId) || { id: res.taskId, assistant_message_id: res.assistantMessageId, status: 'pending', state: {} };
    startLive(t); S.runningConvs.add(S.currentId); renderSidebar();
  }

  /* ------------------------------------------------------------ seguimiento en vivo */
  function startLive(t) {
    S.live = { id: t.id, assistant: t.assistant_message_id, convId: S.currentId };
    if (!S.events[t.id]) { S.events[t.id] = []; S.seq[t.id] = 0; }
    updateComposer(); stopTimer(); tick();
  }
  function stopTimer() { clearTimeout(S.pollTimer); S.pollTimer = null; }
  function stopPolling() { stopTimer(); S.live = null; }
  async function tick() {
    const live = S.live; if (!live) return;
    try {
      const [task, evs] = await Promise.all([data.task(live.id), data.events(live.id, S.seq[live.id] || 0)]);
      if (!S.live || S.live.id !== live.id) return;
      if (evs.length) { S.events[live.id] = [...(S.events[live.id] || []), ...evs]; S.seq[live.id] = evs[evs.length - 1].seq; }
      if (task) {
        const i = S.tasks.findIndex((x) => x.id === task.id); if (i >= 0) S.tasks[i] = { ...S.tasks[i], ...task }; else S.tasks.push(task);
        if (task.assistant_message_id && task.assistant_message_id !== live.assistant) { live.assistant = task.assistant_message_id; await reloadConv(); }
        const msg = live.assistant ? await data.message(live.assistant) : null;
        if (msg) { const m = S.messages.find((x) => x.id === msg.id); if (m) Object.assign(m, msg); else S.messages.push({ ...msg, role: 'assistant', task_id: task.id, created_at: new Date().toISOString() }); }
        paintLive(msg ? msg.id : null);
        if (!ACTIVE.includes(task.status)) return finishLive(task);
      }
    } catch (e) { setStatus(false, errMsg(e)); }
    S.pollTimer = setTimeout(tick, document.hidden ? 4000 : 900);
  }
  function paintLive(msgId) {
    const m = msgId && S.messages.find((x) => x.id === msgId);
    const box = $('#messages'); const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (m) { const old = $(`.msg[data-id="${m.id}"]`); const fresh = messageEl(m, true); if (old) old.replaceWith(fresh); else renderMessages(); }
    const t = S.tasks.find((x) => x.id === S.live.id); $('#live-status').textContent = t ? STATUS[t.status] || '' : '';
    if (near) box.scrollTop = box.scrollHeight;
  }
  async function finishLive(task) {
    const convId = S.live && S.live.convId; stopPolling(); S.runningConvs.delete(convId);
    await Promise.all([reloadConv(), loadConvs()]);
    updateComposer();
    if (task.status === 'awaiting_user') toast('AURA-X necesita que respondas unas preguntas');
    if (task.status === 'awaiting_authorization') toast('AURA-X necesita tu autorización');
    if (task.status === 'failed' && task.last_error && !/Detenida por el usuario/.test(task.last_error)) toast('La tarea no se pudo completar', 'error');
    notify(convId, task.status);
    if (task.status === 'failed') setTimeout(() => { if (S.currentId === convId && !S.live) reloadConv(); }, 1800); // el servidor termina de escribir la nota
    const latest = [...S.artifacts].reverse().find((b) => b.msgId === task.assistant_message_id && render.isPreviewable(b));
    if (latest && task.status === 'completed' && !S.autoOpened.has(latest.msgId) && !isNarrow()) { S.autoOpened.add(latest.msgId); openArtifact(S.artifacts.indexOf(latest)); }
  }
  async function stopTask() {
    if (!S.live) return;
    try { await data.cancel(S.live.id); toast('Deteniendo…'); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function authorize(t, approve) {
    try { await data.authorize(t.id, approve); await reloadConv(); if (approve) { const nt = S.tasks.find((x) => x.id === t.id); if (nt) startLive(nt); } }
    catch (e) { toast(errMsg(e), 'error'); }
  }
  function notify(convId, status) {
    if (!document.hidden || !S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const c = S.convs.find((x) => x.id === convId);
    new Notification('AURA-X', { body: `${c ? c.title + ': ' : ''}${STATUS[status] || status}`, icon: 'icons/icon-192.png', tag: convId });
  }
  async function bgCheck() {
    try {
      const act = await data.activeTasks(); const now = new Set(act.map((t) => t.conversation_id));
      for (const id of S.runningConvs) if (!now.has(id) && !(S.live && S.live.convId === id)) { notify(id, 'completed'); const c = S.convs.find((x) => x.id === id); if (c && id !== S.currentId) toast(`Terminó: ${c.title}`); }
      S.runningConvs = new Set(act.filter((t) => ACTIVE.includes(t.status)).map((t) => t.conversation_id)); renderSidebar();
    } catch { /* sin conexión: se reintenta */ }
  }

  /* ------------------------------------------------------------ compositor */
  const MAX_FILES = 5, MAX_FILE = 4 * 1024 * 1024, MAX_TOTAL = 8 * 1024 * 1024;
  const IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const TEXT_EXT = /\.(txt|md|json|csv|js|mjs|ts|jsx|tsx|html|css|py|sql|ya?ml|xml|sh|java|go|rs|php|rb|c|cpp|h|toml|ini|env\.example)$/i;
  function mimeOf(f) {
    if (IMG.includes(f.type) || f.type === 'application/pdf') return f.type;
    if (f.type.startsWith('text/') || f.type === 'application/json') return f.type;
    if (TEXT_EXT.test(f.name)) return 'text/plain';
    return null;
  }
  function addFiles(list) {
    for (const f of list) {
      if (S.attachments.length >= MAX_FILES) { toast(`Máximo ${MAX_FILES} archivos por mensaje`); break; }
      const mime = mimeOf(f); if (!mime) { toast(`${f.name}: solo imágenes, PDF, texto o código`); continue; }
      if (f.size > MAX_FILE) { toast(`${f.name} supera 4 MB`); continue; }
      if (S.attachments.reduce((n, a) => n + a.file.size, 0) + f.size > MAX_TOTAL) { toast('Los adjuntos no pueden superar 8 MB en total'); break; }
      S.attachments.push({ file: f, mime, url: IMG.includes(mime) ? URL.createObjectURL(f) : null });
    }
    renderAttachments();
  }
  function clearAttachments() { S.attachments.forEach((a) => a.url && URL.revokeObjectURL(a.url)); S.attachments = []; renderAttachments(); }
  function renderAttachments() {
    $('#attach-list').replaceChildren(...S.attachments.map((a, i) => h('div', { class: 'att-pending' },
      a.url ? h('img', { src: a.url, alt: '' }) : h('span', { class: 'att-icon' }, icon('file', 16)),
      h('span', { class: 'att-name' }, a.file.name),
      h('button', { type: 'button', class: 'att-remove', 'aria-label': `Quitar ${a.file.name}`, onclick: () => { if (a.url) URL.revokeObjectURL(a.url); S.attachments.splice(i, 1); renderAttachments(); } }, icon('x', 12)))));
    updateTokens();
  }
  function autoGrow() { const i = $('#input'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 260) + 'px'; }
  function updateTokens() {
    const n = Math.ceil($('#input').value.length / 4); const el = $('#token-est');
    el.hidden = n < 200; el.textContent = `≈ ${n.toLocaleString('es-ES')} tokens`;
  }
  function updateComposer() {
    const w = awaitingTask(); const live = Boolean(S.live);
    $('#input').placeholder = w && w.status === 'awaiting_user' ? 'Responde a las preguntas…' : live ? 'AURA-X está trabajando…' : 'Escribe a AURA-X';
    const send = $('#send'); send.replaceChildren(icon(live ? 'stop' : 'arrowUp', 18)); send.setAttribute('aria-label', live ? 'Detener' : 'Enviar'); send.classList.toggle('stop', live);
    $('#live-bar').hidden = !live;
  }
  function applyComposerSettings() {
    $('#mode-select').value = S.settings.mode; $('#tier-select').value = S.settings.tier; $('#tier-wrap').hidden = S.settings.mode === 'gemini';
  }
  function useTemplate(tpl) { if (!tpl) return; const i = $('#input'); i.value = tpl.text; autoGrow(); updateTokens(); i.focus(); i.setSelectionRange(i.value.length, i.value.length); closeSlash(); }
  let slashItems = [], slashIndex = 0;
  function closeSlash() { $('#slash-menu').hidden = true; slashItems = []; $('#input').setAttribute('aria-expanded', 'false'); }
  function paintSlash() {
    const m = $('#slash-menu');
    m.replaceChildren(...slashItems.map((c, i) => { const b = h('button', { type: 'button', role: 'option', class: 'slash-item' + (i === slashIndex ? ' active' : ''), 'aria-selected': String(i === slashIndex) }, h('span', { class: 'slash-cmd' }, '/' + c.cmd), h('span', { class: 'slash-title' }, c.title), h('span', { class: 'slash-desc' }, c.desc)); b.addEventListener('mousedown', (e) => { e.preventDefault(); useTemplate(c); }); return b; }));
    m.hidden = !slashItems.length; $('#input').setAttribute('aria-expanded', String(slashItems.length > 0));
    const a = m.querySelector('.active'); if (a) a.scrollIntoView({ block: 'nearest' });
  }
  function updateSlash() { const v = $('#input').value; if (/^\/[\wáéíóúñ]*$/i.test(v)) { slashItems = prompts.filterSlash(v); slashIndex = 0; paintSlash(); } else closeSlash(); }
  let recognition = null;
  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const btn = $('#mic'); if (!SR) return; btn.hidden = false;
    btn.addEventListener('click', () => {
      if (recognition) { recognition.stop(); return; }
      const input = $('#input'); const base = input.value ? input.value.replace(/\s*$/, ' ') : '';
      recognition = new SR(); recognition.lang = 'es-ES'; recognition.interimResults = true; recognition.continuous = true;
      recognition.onresult = (e) => { let t = ''; for (const r of e.results) t += r[0].transcript; input.value = base + t; autoGrow(); };
      recognition.onerror = (e) => { if (!['no-speech', 'aborted'].includes(e.error)) toast(e.error === 'not-allowed' ? 'Permiso de micrófono denegado' : `Dictado: ${e.error}`, 'error'); };
      recognition.onend = () => { recognition = null; btn.classList.remove('recording'); btn.setAttribute('aria-pressed', 'false'); };
      try { recognition.start(); btn.classList.add('recording'); btn.setAttribute('aria-pressed', 'true'); } catch { recognition = null; }
    });
  }

  /* ------------------------------------------------------------ panel de código y vista previa */
  function collectArtifacts() { S.artifacts = render.extractCodeBlocks(S.messages); if (S.artifactIndex >= S.artifacts.length) S.artifactIndex = S.artifacts.length - 1; renderTopbar(); if (!$('#artifact').hidden) paintArtifact(); }
  function openArtifactFor(b) { const i = S.artifacts.findIndex((x) => x.msgId === (S.messages.find((m) => (m.content || '').includes(b.content)) || {}).id && x.content === b.content); openArtifact(i >= 0 ? i : S.artifacts.findIndex((x) => x.content === b.content)); }
  function openArtifact(i) {
    if (i < 0 || !S.artifacts[i]) return;
    S.artifactIndex = i; S.artifactTab = render.isPreviewable(S.artifacts[i]) ? 'preview' : 'code';
    $('#artifact').hidden = false; document.body.classList.add('with-artifact'); paintArtifact();
  }
  function closeArtifact() { $('#artifact').hidden = true; document.body.classList.remove('with-artifact'); const f = $('#artifact-frame'); if (f) f.srcdoc = ''; }
  function paintArtifact() {
    const b = S.artifacts[S.artifactIndex]; if (!b) return closeArtifact();
    const sel = $('#artifact-select'); sel.replaceChildren(...S.artifacts.map((x, i) => h('option', { value: String(i), selected: i === S.artifactIndex }, render.artifactTitle(x))));
    const can = render.isPreviewable(b); if (!can) S.artifactTab = 'code';
    $$('#artifact-tabs [role="tab"]').forEach((t) => { t.setAttribute('aria-selected', String(t.dataset.tab === S.artifactTab)); t.disabled = t.dataset.tab === 'preview' && !can; });
    $('#artifact-devices').hidden = S.artifactTab !== 'preview';
    $('#artifact-preview').hidden = S.artifactTab !== 'preview'; $('#artifact-code').hidden = S.artifactTab !== 'code';
    if (S.artifactTab === 'preview') {
      const isSvg = String(b.lang).toLowerCase() === 'svg' || /^\s*<svg/i.test(b.content);
      const doc = isSvg ? `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${b.content}</body>` : b.content;
      const f = $('#artifact-frame'); if (f.srcdoc !== doc) f.srcdoc = doc; f.style.width = S.previewWidth;
      $$('#artifact-devices button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.w === S.previewWidth)));
    } else $('#artifact-code-text').textContent = b.content;
  }
  function downloadCode(b) { const ext = render.langExt(b.lang); ui.download(`aura-x.${ext}`, b.content, ext === 'html' ? 'text/html' : 'text/plain'); }

  /* ------------------------------------------------------------ exportar */
  async function exportMarkdown(c = conv()) {
    if (!c) return;
    try {
      const msgs = c.id === S.currentId ? S.messages : await data.messages(c.id);
      const md = [`# ${c.title}`, '', ...msgs.filter((m) => m.role !== 'system').flatMap((m) => [`## ${m.role === 'user' ? 'Tú' : 'AURA-X'}`, '', m.content, ''])].join('\n');
      ui.download(`${ui.safeName(c.title, 'conversacion')}.md`, md, 'text/markdown');
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function exportAll() {
    try { toast('Preparando la exportación…'); const d = await data.exportAll(); ui.download(`aura-x-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 2), 'application/json'); }
    catch (e) { toast(errMsg(e), 'error'); }
  }

  /* ------------------------------------------------------------ proyectos */
  function renderProjects() {
    showView('projects');
    const list = $('#projects-list'); list.replaceChildren();
    if (!S.projects.length) list.append(h('div', { class: 'projects-empty' }, h('p', null, 'Los proyectos agrupan conversaciones y comparten unas instrucciones: el stack, las convenciones o las decisiones ya tomadas.'), h('button', { class: 'btn primary', type: 'button', onclick: () => $('#new-project-name').focus() }, 'Crear el primero')));
    for (const p of S.projects) {
      const n = S.convs.filter((c) => c.project_id === p.id).length;
      list.append(h('button', { class: 'project-row', type: 'button', onclick: () => openProject(p.id) },
        h('span', { class: 'project-name' }, p.name), h('span', { class: 'project-info' }, p.instructions ? p.instructions.slice(0, 90) : 'Sin instrucciones'), h('span', { class: 'project-count' }, n === 1 ? '1 conversación' : `${n} conversaciones`)));
    }
  }
  async function createProject(e) {
    e.preventDefault(); const name = $('#new-project-name').value.trim();
    if (!name) return; if (name.length > 40) return toast('El nombre admite 40 caracteres como máximo');
    try { const p = await data.createProject(name); S.projects.push(p); S.projects.sort((a, b) => a.name.localeCompare(b.name, 'es')); $('#new-project-name').value = ''; openProject(p.id); toast('Proyecto creado'); }
    catch (er) { toast(errMsg(er), 'error'); }
  }
  function openProject(id) {
    const p = project(id); if (!p) return renderProjects();
    S.projectViewId = id; showView('project');
    $('#pj-name').value = p.name; $('#pj-instructions').value = p.instructions || ''; $('#pj-count').textContent = `${(p.instructions || '').length}/4000`;
    const convs = S.convs.filter((c) => c.project_id === id);
    $('#pj-convs').replaceChildren(...(convs.length ? convs.map((c) => h('li', null, h('button', { class: 'pj-conv', type: 'button', onclick: () => openConv(c.id) }, h('span', null, c.title), h('span', { class: 'pj-date' }, ui.fmtDate(c.updated_at)))))
      : [h('li', { class: 'side-empty' }, 'Todavía no hay conversaciones en este proyecto.')]));
  }
  async function saveProject() {
    const p = project(S.projectViewId); if (!p) return;
    const patch = { name: $('#pj-name').value.trim(), instructions: $('#pj-instructions').value };
    if (!patch.name) return toast('El proyecto necesita un nombre');
    try { await data.updateProject(p.id, patch); Object.assign(p, patch); renderTopbar(); toast('Proyecto guardado'); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function deleteProject() {
    const p = project(S.projectViewId); if (!p) return;
    if (!(await ui.ask({ title: 'Eliminar proyecto', message: `Se eliminará «${p.name}». Sus conversaciones se conservan, sin proyecto.`, confirmText: 'Eliminar', danger: true }))) return;
    try { await data.deleteProject(p.id); S.projects = S.projects.filter((x) => x.id !== p.id); S.convs.forEach((c) => { if (c.project_id === p.id) c.project_id = null; }); renderProjects(); toast('Proyecto eliminado'); }
    catch (e) { toast(errMsg(e), 'error'); }
  }

  /* ------------------------------------------------------------ ajustes */
  let settingsTab = 'general'; let draft = null;
  function openSettings(tab = 'general') {
    draft = JSON.parse(JSON.stringify(S.settings)); fillSettings(); selectSettings(tab); $('#settings').showModal();
  }
  function selectSettings(tab) {
    settingsTab = tab;
    $$('#settings-nav [role="tab"]').forEach((t) => { const on = t.dataset.tab === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    $$('#settings .set-panel').forEach((p) => { p.hidden = p.id !== `set-${tab}`; });
    if (tab === 'usage') loadUsage(); if (tab === 'account') fillAccount();
  }
  function fillSettings() {
    const t = localStorage.getItem('aura.theme') || 'system'; $$('input[name="theme"]').forEach((r) => { r.checked = r.value === t; });
    $('#set-mode').value = draft.mode; $('#set-tier').value = draft.tier; $('#set-notify').checked = draft.notify;
    $('#set-instructions').value = draft.instructions; $('#set-instr-count').textContent = `${draft.instructions.length}/2000`;
    $('#set-agents-auto').checked = draft.agentsAuto; $('#set-review').checked = draft.reviewAgents; $('#set-rounds').value = draft.maxReviewRounds; $('#set-confirm').checked = draft.confirmDestructive; $('#set-budget').value = draft.budgetUsd;
    renderAgentChecks(); renderMcp();
  }
  function renderAgentChecks() {
    $('#set-agent-list').replaceChildren(...prompts.AGENTS.map((a) => {
      const input = h('input', { type: 'checkbox', checked: draft.agents.includes(a.id), disabled: draft.agentsAuto });
      input.addEventListener('change', () => { draft.agents = input.checked ? [...new Set([...draft.agents, a.id])] : draft.agents.filter((x) => x !== a.id); });
      return h('label', { class: 'check-row' + (draft.agentsAuto ? ' off' : '') }, input, h('span', null, h('strong', null, a.name), h('small', null, a.desc)));
    }));
  }
  function renderMcp() {
    const list = draft.mcp || [];
    $('#mcp-list').replaceChildren(...(list.length ? list.map((s, i) => h('li', { class: 'mcp-row' },
      h('div', { class: 'mcp-info' }, h('strong', null, s.name), h('span', null, s.url), s.tools ? h('small', null, s.tools.length ? `Herramientas: ${s.tools.map((t) => t.name).join(', ')}` : 'Sin herramientas') : null),
      h('label', { class: 'switch', title: s.enabled ? 'Activado' : 'Desactivado' }, h('input', { type: 'checkbox', checked: s.enabled, 'aria-label': `Activar ${s.name}`, onchange: (e) => { s.enabled = e.target.checked; } }), h('span', { class: 'slider' })),
      h('button', { class: 'btn small', type: 'button', onclick: () => inspectMcp(s) }, 'Probar'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Quitar ${s.name}`, onclick: () => { draft.mcp.splice(i, 1); renderMcp(); } }, icon('trash', 15))))
      : [h('li', { class: 'side-empty' }, 'Aún no has añadido conectores.')]));
  }
  function addMcp(e) {
    e.preventDefault();
    const name = $('#mcp-name').value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40); const url = $('#mcp-url').value.trim();
    let u; try { u = new URL(url); } catch { return void ($('#mcp-error').textContent = 'La URL no es válida'); }
    if (!name) return void ($('#mcp-error').textContent = 'Ponle un nombre');
    if (u.protocol !== 'https:') return void ($('#mcp-error').textContent = 'Usa una dirección https://');
    if ([...u.searchParams.keys()].some((k) => /key|token|secret|password|auth/i.test(k)) || u.username) return void ($('#mcp-error').textContent = 'No pongas claves en la URL: guárdalas como secreto en Supabase');
    draft.mcp = draft.mcp || [];
    if (draft.mcp.some((s) => s.name === name || s.url === u.href)) return void ($('#mcp-error').textContent = 'Ya tienes un conector con ese nombre o dirección');
    if (draft.mcp.length >= 5) return void ($('#mcp-error').textContent = 'Máximo 5 conectores');
    draft.mcp.push({ name, url: u.href, enabled: true, tools: null }); $('#mcp-form').reset(); $('#mcp-error').textContent = ''; renderMcp();
  }
  async function inspectMcp(s) {
    try { const r = await data.mcpInspect(s.name, s.url); s.tools = r.tools; renderMcp(); toast(`${s.name}: ${r.tools.length} herramientas`); }
    catch (e) { toast(errMsg(e), 'error'); }
  }
  async function loadUsage() {
    const box = $('#usage-body'); box.replaceChildren(h('p', { class: 'muted' }, 'Cargando…'));
    try {
      const rows = await data.usage(new Date(Date.now() - 30 * 86400000).toISOString()); const u = data.summarizeUsage(rows, 14);
      const max = Math.max(...u.series.map((d) => d.cost), 0.0001);
      box.replaceChildren(
        h('div', { class: 'usage-figures' },
          h('div', null, h('span', { class: 'fig' }, `$${u.totals.cost.toFixed(2)}`), h('span', { class: 'fig-label' }, 'coste conocido en 30 días')),
          h('div', null, h('span', { class: 'fig' }, u.totals.calls.toLocaleString('es-ES')), h('span', { class: 'fig-label' }, 'llamadas a modelos')),
          h('div', null, h('span', { class: 'fig' }, (u.totals.input + u.totals.output).toLocaleString('es-ES')), h('span', { class: 'fig-label' }, 'tokens'))),
        h('div', { class: 'bars', role: 'img', 'aria-label': 'Coste por día en las dos últimas semanas' }, u.series.map((d) => h('div', { class: 'bar', title: `${d.day}: $${d.cost.toFixed(4)}`, style: `height:${Math.max(2, (d.cost / max) * 100)}%` }))),
        u.models.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'usage-table' }, h('tr', null, h('th', null, 'Modelo'), h('th', null, 'Llamadas'), h('th', null, 'Tokens'), h('th', null, 'Coste')),
          u.models.map((m) => h('tr', null, h('td', null, prettyModel(m.model)), h('td', null, String(m.calls)), h('td', null, (m.input + m.output).toLocaleString('es-ES')),
            h('td', null, m.provider === 'gemini' && m.cost === 0 && !m.unknown ? 'Gratis' : m.unknown === m.calls ? 'Sin dato' : `$${m.cost.toFixed(4)}${m.unknown ? ' + sin dato' : ''}`)))))
          : h('p', { class: 'muted' }, 'Todavía no hay consumo registrado.'),
        u.totals.unknownCalls ? h('p', { class: 'hint' }, `${u.totals.unknownCalls} llamadas sin coste conocido. Para estimarlo, añade la variable PRICES_JSON en los secretos de Supabase con el precio por millón de tokens de cada modelo.`) : null);
    } catch (e) { box.replaceChildren(h('p', { class: 'error-text' }, errMsg(e))); }
  }
  async function fillAccount() {
    const c = supa.config || {}; $('#acc-email').textContent = (supa.user && supa.user.email) || ''; $('#acc-server').textContent = c.url || ''; $('#acc-fn').textContent = c.fn || '';
    const list = $('#acc-health'); list.replaceChildren(h('li', null, 'Comprobando…'));
    await checkHealth(); const hl = S.health;
    list.replaceChildren(...(hl ? [['Función de AURA-X', true], ['Gemini (GEMINI_API_KEY)', hl.gemini], ['Claude (ANTHROPIC_API_KEY)', hl.claude], ['Segundo plano (WORKER_SECRET)', hl.worker]]
      .map(([n, ok]) => h('li', { class: ok ? 'ok' : 'bad' }, icon(ok ? 'check' : 'x', 14), n)) : [h('li', { class: 'bad' }, icon('x', 14), 'La función no responde')]));
  }
  async function saveSettings() {
    draft.instructions = $('#set-instructions').value.slice(0, 2000); draft.mode = $('#set-mode').value; draft.tier = $('#set-tier').value;
    draft.notify = $('#set-notify').checked; draft.agentsAuto = $('#set-agents-auto').checked; draft.reviewAgents = $('#set-review').checked;
    draft.maxReviewRounds = Math.min(5, Math.max(1, parseInt($('#set-rounds').value, 10) || 1)); draft.confirmDestructive = $('#set-confirm').checked;
    const b = $('#set-budget').value.trim(); draft.budgetUsd = b && Number(b) > 0 ? String(Number(b)) : '';
    const theme = $('input[name="theme"]:checked'); if (theme) setTheme(theme.value);
    if (draft.notify && 'Notification' in window && Notification.permission === 'default') { if ((await Notification.requestPermission()) !== 'granted') { draft.notify = false; toast('No se concedió el permiso de avisos'); } }
    try { await data.saveSettings(draft); S.settings = draft; applyComposerSettings(); $('#settings').close(); toast('Ajustes guardados'); }
    catch (e) { toast(errMsg(e), 'error'); }
  }
  async function quickSetting(patch) { Object.assign(S.settings, patch); applyComposerSettings(); try { await data.saveSettings(S.settings); } catch (e) { toast(errMsg(e), 'error'); } }

  /* ------------------------------------------------------------ buscador */
  async function paletteItems(q) {
    const M = A.palette.matches; const acts = [
      { icon: 'plus', title: 'Nueva conversación', hint: 'Alt N', run: () => newChat() },
      { icon: 'folder', title: 'Proyectos', run: renderProjects },
      { icon: 'gear', title: 'Ajustes', run: () => openSettings('general') },
      { icon: 'users', title: 'Agentes especializados', run: () => openSettings('agents') },
      { icon: 'plug', title: 'Conectores MCP', run: () => openSettings('mcp') },
      { icon: 'chart', title: 'Uso y costes', run: () => openSettings('usage') },
      { icon: 'sun', title: 'Cambiar tema', run: () => { const t = localStorage.getItem('aura.theme') || 'system'; setTheme({ system: 'light', light: 'dark', dark: 'system' }[t]); toast(`Tema: ${{ system: 'claro', light: 'oscuro', dark: 'del sistema' }[t]}`); } },
      { icon: 'download', title: 'Exportar esta conversación en Markdown', run: () => exportMarkdown() },
      { icon: 'keyboard', title: 'Atajos de teclado', hint: '?', run: () => $('#shortcuts').showModal() },
    ];
    if (S.live) acts.unshift({ icon: 'stop', title: 'Detener la tarea en curso', run: stopTask });
    const out = acts.filter((a) => !q.trim() || M(a.title, q)).map((a) => ({ group: 'Acciones', ...a }));
    for (const p of S.projects) if (!q.trim() || M(p.name, q)) out.push({ group: 'Proyectos', icon: 'folder', title: p.name, run: () => openProject(p.id) });
    let convs = S.convs.filter((c) => !q.trim() || M(c.title, q));
    if (q.trim().length >= 3) { try { const hits = await data.searchContent(q); convs = [...new Set([...convs, ...S.convs.filter((c) => hits.includes(c.id))])]; } catch { /* nada */ } }
    for (const c of convs.slice(0, q.trim() ? 15 : 8)) out.push({ group: 'Conversaciones', icon: 'chat', title: c.title, hint: ui.fmtDate(c.updated_at), run: () => openConv(c.id) });
    return out;
  }

  /* ------------------------------------------------------------ paneles laterales */
  function toggleSidebar() {
    if (isNarrow()) { const on = !$('#sidebar').classList.contains('open'); $('#sidebar').classList.toggle('open', on); $('#scrim').hidden = !on; }
    else { document.body.classList.toggle('side-collapsed'); localStorage.setItem('aura.sideCollapsed', document.body.classList.contains('side-collapsed') ? '1' : ''); }
  }
  function closeDrawer() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; }

  /* ------------------------------------------------------------ arranque */
  function bind() {
    $('#connect-form').addEventListener('submit', connect);
    $('#lg-google').addEventListener('click', () => { $('#lg-google').disabled = true; location.href = supa.oauthUrl('google'); });
    $('#change-server').addEventListener('click', () => showAuth('connect'));

    $('#new-chat').addEventListener('click', () => newChat());
    $('#nav-projects').addEventListener('click', renderProjects);
    $('#search').addEventListener('input', onSearch);
    $('#toggle-archived').addEventListener('click', () => { S.showArchived = !S.showArchived; renderSidebar(); });
    $('#user-btn').addEventListener('click', (e) => ui.menu(e.currentTarget, [
      { label: 'Ajustes', icon: 'gear', run: () => openSettings('general') }, { label: 'Uso y costes', icon: 'chart', run: () => openSettings('usage') },
      { label: 'Atajos de teclado', icon: 'keyboard', hint: '?', run: () => $('#shortcuts').showModal() }, { separator: true },
      { label: 'Cerrar sesión', icon: 'logout', run: signOut }]));
    $('#toggle-sidebar').addEventListener('click', toggleSidebar); $('#collapse-sidebar').addEventListener('click', toggleSidebar);
    $('#scrim').addEventListener('click', closeDrawer);
    $('#chat-title').addEventListener('click', () => { const c = conv(); if (c && S.view === 'chat') renameConv(c); });
    $('#conv-actions').addEventListener('click', (e) => { const c = conv(); if (c) convMenu(e.currentTarget, c); });
    $('#open-palette').addEventListener('click', () => pal.open());
    $('#toggle-artifacts').addEventListener('click', () => ($('#artifact').hidden ? openArtifact(S.artifactIndex >= 0 ? S.artifactIndex : S.artifacts.length - 1) : closeArtifact()));

    const input = $('#input');
    $('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
    input.addEventListener('keydown', (e) => {
      if (!$('#slash-menu').hidden) {
        if (e.key === 'ArrowDown') { e.preventDefault(); slashIndex = (slashIndex + 1) % slashItems.length; return paintSlash(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); slashIndex = (slashIndex - 1 + slashItems.length) % slashItems.length; return paintSlash(); }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return useTemplate(slashItems[slashIndex]); }
        if (e.key === 'Escape') { e.preventDefault(); return closeSlash(); }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isNarrow()) { e.preventDefault(); if (!S.live) send(); }
    });
    input.addEventListener('input', () => { autoGrow(); updateTokens(); updateSlash(); });
    input.addEventListener('blur', () => setTimeout(closeSlash, 150));
    input.addEventListener('paste', (e) => { const f = e.clipboardData && e.clipboardData.files; if (f && f.length) { e.preventDefault(); addFiles([...f]); } });
    $('#attach').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
    $('#mode-select').addEventListener('change', (e) => quickSetting({ mode: e.target.value }));
    $('#tier-select').addEventListener('change', (e) => quickSetting({ tier: e.target.value }));
    $('#live-stop').addEventListener('click', stopTask);
    let depth = 0; const main = $('#view-chat');
    main.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { depth++; $('#drop').hidden = false; } });
    main.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#drop').hidden = true; });
    main.addEventListener('dragover', (e) => e.preventDefault());
    main.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('#drop').hidden = true; if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
    setupVoice();

    $('#new-project-form').addEventListener('submit', createProject);
    $('#pj-save').addEventListener('click', saveProject); $('#pj-delete').addEventListener('click', deleteProject);
    $('#pj-new-chat').addEventListener('click', () => newChat(S.projectViewId));
    $('#pj-back').addEventListener('click', renderProjects);
    $('#pj-instructions').addEventListener('input', (e) => { $('#pj-count').textContent = `${e.target.value.length}/4000`; });

    $('#artifact-select').addEventListener('change', (e) => { S.artifactIndex = Number(e.target.value); paintArtifact(); });
    $$('#artifact-tabs [role="tab"]').forEach((t) => t.addEventListener('click', () => { S.artifactTab = t.dataset.tab; paintArtifact(); }));
    $$('#artifact-devices button').forEach((b) => b.addEventListener('click', () => { S.previewWidth = b.dataset.w; paintArtifact(); }));
    $('#artifact-copy').addEventListener('click', () => { const b = S.artifacts[S.artifactIndex]; if (b) copyText(b.content); });
    $('#artifact-download').addEventListener('click', () => { const b = S.artifacts[S.artifactIndex]; if (b) downloadCode(b); });
    $('#artifact-close').addEventListener('click', closeArtifact);

    $$('#settings-nav [role="tab"]').forEach((t, i, all) => {
      t.addEventListener('click', () => selectSettings(t.dataset.tab));
      t.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]; n.focus(); selectSettings(n.dataset.tab); } });
    });
    $('#settings-save').addEventListener('click', saveSettings);
    $('#set-instructions').addEventListener('input', (e) => { $('#set-instr-count').textContent = `${e.target.value.length}/2000`; });
    $('#set-agents-auto').addEventListener('change', (e) => { draft.agentsAuto = e.target.checked; renderAgentChecks(); });
    $('#mcp-form').addEventListener('submit', addMcp);
    $('#acc-export').addEventListener('click', exportAll);
    $('#acc-signout').addEventListener('click', () => { $('#settings').close(); signOut(); });
    $('#acc-server-change').addEventListener('click', async () => {
      if (!(await ui.ask({ title: 'Cambiar de servidor', message: 'Se cerrará tu sesión en este navegador para conectar con otro proyecto de Supabase.', confirmText: 'Continuar' }))) return;
      $('#settings').close(); await supa.signOut(); showAuth('connect');
    });
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d && d.id !== 'palette') d.close(); }));

    document.addEventListener('keydown', (e) => {
      if ($('#app').hidden) return;
      const mod = e.ctrlKey || e.metaKey; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') || (document.activeElement || {}).isContentEditable;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.open(); }
      else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); }
      else if (e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
      else if (e.key === 'Escape' && !$$('dialog[open]').length) { if (!$('#artifact').hidden && isNarrow()) closeArtifact(); closeDrawer(); }
      else if (!typing && !mod && e.key === '/') { e.preventDefault(); input.focus(); }
      else if (!typing && !mod && e.key === '?') { e.preventDefault(); $('#shortcuts').showModal(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.live && !S.pollTimer) tick(); if (!document.hidden && supa.session) bgCheck(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    window.addEventListener('online', () => { if (supa.session) checkHealth(); });
  }

  let pal;
  async function boot() {
    applyTheme(); if (localStorage.getItem('aura.sideCollapsed')) document.body.classList.add('side-collapsed');
    $('#brand-logo').replaceChildren(ui.logo(24)); $('#auth-logo').replaceChildren(ui.logo(40));
    bind(); pal = A.palette.create({ getItems: paletteItems });
    supa.onSession((s) => { if (!s && !$('#app').hidden) showAuth('login'); });
    try { if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {}); } catch { /* sin service worker */ }
    if (!supa.config) return showAuth('connect');
    const qs = new URLSearchParams(location.hash.slice(1) || location.search.slice(1)); const oerr = qs.get('error_description');
    if (oerr) { history.replaceState(null, '', location.pathname); showAuth('login'); $('#auth-error').textContent = decodeURIComponent(oerr.replace(/\+/g, ' ')); return; }
    if (await supa.fromRedirect()) return enterApp();
    if (!supa.session) return showAuth('login');
    try { await supa.refresh(); } catch { return showAuth('login'); }
    enterApp();
  }
  A.app = { S, prettyModel };
  boot();
})();
