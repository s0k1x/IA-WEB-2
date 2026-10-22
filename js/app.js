/* NEXUS AI · interfaz principal */
(function () {
  'use strict';
  const N = window.Nexus;
  const { api, convs, mcp, render, store } = N;
  const $ = (s) => document.querySelector(s);
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null && kid !== false) e.append(kid);
    return e;
  };

  const conversations = convs.createStore(localStorage);
  const servers = mcp.createRegistry(localStorage);
  const tasks = new Map(); // id -> { id, state, convId, logFrom }
  let currentId = null;
  let polling = false;
  let pollTimer = null;
  let attachments = [];
  let loaderLabel = null;

  const PREFS_KEY = 'nexus.prefs.v1';
  const DEFAULT_PREFS = { tier: 'general', confirmDestructive: true, reviewAgents: false, webSearch: false, autonomous: false, notify: false, budgetUsd: '' };
  let prefs = loadPrefs();
  function loadPrefs() {
    try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) }; }
    catch { return { ...DEFAULT_PREFS }; }
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* sin espacio */ } }

  /* ---------- utilidades ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }
  function note(text) { appendMessage({ role: 'system', text }); }
  function closePanels() { $('#sidebar').classList.remove('open'); $('#activity').classList.remove('open'); }

  /* ---------- conexión ---------- */
  function setConn(ok, detail) {
    const b = $('#conn'); b.dataset.ok = String(ok); b.title = ok ? 'Supabase conectado' : 'Sin conexión' + (detail ? ` · ${detail}` : '');
    b.textContent = ok ? 'Supabase conectado' : 'Sin conexión' + (detail ? ` · ${detail}` : '');
  }
  async function checkBackend() {
    if (!api.isConfigured()) { setConn(false, 'sin configurar'); $('#setup').hidden = false; return false; }
    try { await api.health(); setConn(true); $('#setup').hidden = true; return true; }
    catch (e) { setConn(false, e.message); return false; }
  }

  /* ---------- conversaciones ---------- */
  function renderConvList() {
    const q = $('#conv-search').value;
    const list = conversations.search(q);
    const ul = $('#conv-list');
    ul.replaceChildren(...list.map((c) => h('li', { class: 'conv-item' + (c.id === currentId ? ' active' : '') },
      h('button', { class: 'conv-open', type: 'button', title: c.title, onclick: () => openConversation(c.id) }, c.title),
      h('button', { class: 'conv-del', type: 'button', 'aria-label': `Eliminar «${c.title}»`, onclick: () => deleteConversation(c.id) }, '✕'))));
    if (!list.length) ul.append(h('li', { class: 'hint' }, q ? 'Sin resultados' : 'Aún no hay conversaciones'));
  }

  function emptyState() {
    const ideas = [
      'Crea una web de reservas con panel de administración',
      'Revisa la seguridad de mi API',
      'Diseña el esquema de base de datos de una tienda',
      'Haz una app de tareas con login',
    ];
    return h('div', { class: 'empty' },
      h('div', { class: 'brand-mark big' }, 'N'),
      h('h1', null, '¿Qué construimos hoy?'),
      h('p', null, 'NEXUS coordina varios agentes de IA para planificar, construir, revisar y probar tu proyecto.'),
      h('div', { class: 'chips' }, ...ideas.map((t) => h('button', { class: 'chip', type: 'button', onclick: () => { $('#chat-input').value = t; autoGrow(); $('#chat-input').focus(); } }, t))));
  }

  function renderMessages() {
    const box = $('#messages');
    const c = currentId && conversations.get(currentId);
    if (!c || !c.messages.length) { box.replaceChildren(emptyState()); return; }
    box.replaceChildren(...c.messages.map(render.message));
    box.scrollTop = box.scrollHeight;
  }
  function appendMessage(m) {
    const box = $('#messages');
    if (box.querySelector('.empty')) box.replaceChildren();
    box.append(render.message(m));
    box.scrollTop = box.scrollHeight;
  }

  function openConversation(id) {
    currentId = id; renderConvList(); renderMessages(); updateActivity(); closePanels();
  }
  function newConversation() {
    currentId = null; attachments = []; renderAttachments(); renderConvList(); renderMessages(); updateActivity();
    closePanels(); $('#chat-input').focus();
  }
  function deleteConversation(id) {
    const c = conversations.get(id); if (!c) return;
    if (!confirm(`¿Eliminar «${c.title}»? No se puede deshacer.`)) return;
    conversations.remove(id);
    if (currentId === id) currentId = null;
    renderConvList(); renderMessages(); updateActivity();
  }

  /* ---------- tareas ---------- */
  function tasksOf(convId) { return [...tasks.values()].filter((t) => t.convId === convId); }
  function latestTask(convId) { const l = tasksOf(convId); return l[l.length - 1] || null; }

  async function send() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text && !attachments.length) return;
    if (!currentId) currentId = conversations.create().id;
    const shown = text + (attachments.length ? `\n\n📎 ${attachments.map((a) => a.name).join(', ')}` : '');
    const conv = conversations.addMessage(currentId, 'user', shown);
    appendMessage(conv.messages[conv.messages.length - 1]);
    const files = attachments;
    input.value = ''; autoGrow(); attachments = []; renderAttachments(); renderConvList();

    if (!(await checkBackend())) {
      note('Mensaje guardado en este navegador. Para que NEXUS responda, conecta Supabase en Configuración.');
      return;
    }
    const waiting = tasksOf(currentId).find((t) => t.state.status === 'awaiting_user');
    try {
      if (waiting) { await api.answerTask(waiting.id, text); startPolling(); return; }
      const budget = parseFloat(prefs.budgetUsd);
      const res = await api.createTask({
        conversationId: conv.remoteId,
        prompt: text,
        attachments: files.map(({ name, size, content }) => ({ name, size, content })),
        tier: prefs.tier,
        options: {
          confirmDestructive: prefs.confirmDestructive, reviewAgents: prefs.reviewAgents,
          webSearch: prefs.webSearch, autonomous: prefs.autonomous,
          budgetUsd: Number.isFinite(budget) && budget > 0 ? budget : null,
        },
        mcpServers: servers.enabledForTask(),
      });
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
      const prev = entry.state.status;
      for (const ev of evs) {
        const before = entry.state.messages.length;
        entry.state = store.applyEvent(entry.state, ev);
        for (const m of entry.state.messages.slice(before)) {
          if (!conversations.get(entry.convId)) continue;
          const c = conversations.addMessage(entry.convId, m.role === 'user' ? 'user' : 'assistant', m.text);
          if (entry.convId === currentId) appendMessage(c.messages[c.messages.length - 1]);
        }
      }
      if (entry.state.status !== prev) onStatusChange(entry);
    }
    updateActivity(); renderConvList();
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
    const s = entry.state.status;
    const label = store.STATUS_ES[s] || s;
    if (s === 'awaiting_user') toast('NEXUS necesita tu respuesta');
    if (s === 'awaiting_authorization') toast('NEXUS espera tu autorización');
    if (prefs.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted'
      && ['completed', 'failed', 'awaiting_user', 'awaiting_authorization'].includes(s)) {
      const c = conversations.get(entry.convId);
      new Notification('NEXUS AI', { body: `${c ? c.title + ': ' : ''}${label}`, tag: entry.id });
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
    const ul = $(sel);
    ul.replaceChildren(...(items.length ? items.map((t) => h('li', null, t)) : [h('li', { class: 'muted' }, empty)]));
  }
  function setLoaderStatus(label) {
    if (label === loaderLabel) return;
    const w = $('#loader-words');
    w.classList.remove('roll');
    w.replaceChildren(...(loaderLabel ? [loaderLabel, label] : [label]).map((t) => h('span', { class: 'loader-word' }, t)));
    if (loaderLabel) { void w.offsetWidth; w.classList.add('roll'); }
    loaderLabel = label;
  }
  function renderTerminal(entry) {
    const body = $('#term-body');
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    $('#term-user').textContent = `nexus@supabase: ~/${entry ? entry.id.slice(0, 8) : ''}`;
    const lines = entry ? entry.state.log.slice(entry.logFrom) : [];
    const prompt = h('div', { class: 'term-prompt' },
      h('span', { class: 'term-u' }, 'nexus@supabase:'), h('span', { class: 'term-loc' }, '~'),
      h('span', { class: 'term-bling' }, '$'), h('span', { class: 'term-cursor' }));
    body.replaceChildren(...lines.map((l) => h('div', { class: 'term-line ' + l.kind },
      h('span', { class: 'term-time' }, new Date(l.at).toLocaleTimeString()), h('span', { class: 'term-text' }, l.text))), prompt);
    if (nearBottom) body.scrollTop = body.scrollHeight;
  }
  function updateActivity() {
    const entry = currentId ? latestTask(currentId) : null;
    const t = entry && entry.state;
    $('#act-empty').hidden = Boolean(t);
    $('#act-task').hidden = !t;
    const busy = Boolean(t) && store.isActive(t);
    $('#chat-glow').classList.toggle('busy', busy);
    $('#working').hidden = !busy;
    renderTerminal(entry);
    if (!t) return;
    const label = store.STATUS_ES[t.status] || t.status;
    const pill = $('#act-status'); pill.textContent = label; pill.dataset.state = t.status;
    if (busy) setLoaderStatus(label);
    $('#act-agent').textContent = t.agent ? `${t.agent.name} · ${t.agent.model}` : '—';
    $('#act-handoffs').textContent = String(t.handoffs);
    fill('#act-files', t.files, 'Ninguno todavía');
    fill('#act-errors', t.errors.map((e) => `${e.kind}: ${e.message}`), 'Sin errores');
    $('#cost-rep').textContent = `$${t.usage.reported.toFixed(4)}`;
    $('#cost-est').textContent = `$${t.usage.estimated.toFixed(4)}`;
    $('#cost-unk').textContent = String(t.usage.unknownCalls);
    $('#authz').hidden = t.status !== 'awaiting_authorization';
  }

  async function authorize(approve) {
    const entry = currentId && latestTask(currentId);
    if (!entry) return;
    try { await api.authorize(entry.id, approve); toast(approve ? 'Autorizado' : 'Rechazado'); startPolling(); }
    catch (e) { toast(`No se pudo enviar: ${e.message}`); }
  }
  async function stopTask() {
    const entry = currentId && latestTask(currentId);
    if (!entry || !store.isActive(entry.state)) return;
    try { await api.cancelTask(entry.id); toast('Se ha pedido detener la tarea'); startPolling(); }
    catch (e) { toast(`No se pudo detener: ${e.message}`); }
  }

  /* ---------- adjuntos ---------- */
  const MAX_FILES = 5, MAX_BYTES = 200 * 1024;
  const TEXT_EXT = /\.(txt|md|json|csv|js|ts|jsx|tsx|html|css|py|sql|yml|yaml|xml|env\.example|sh|java|go|rs|php|rb|c|cpp|h)$/i;
  function renderAttachments() {
    $('#attach-list').replaceChildren(...attachments.map((a, i) => h('span', { class: 'attach-chip' },
      `${a.name} · ${Math.ceil(a.size / 1024)} KB`,
      h('button', { type: 'button', 'aria-label': `Quitar ${a.name}`, onclick: () => { attachments.splice(i, 1); renderAttachments(); } }, '✕'))));
  }
  async function addFiles(fileList) {
    for (const f of fileList) {
      if (attachments.length >= MAX_FILES) { toast(`Máximo ${MAX_FILES} archivos`); break; }
      if (f.size > MAX_BYTES) { toast(`${f.name} supera 200 KB`); continue; }
      if (!(f.type.startsWith('text/') || f.type === 'application/json' || TEXT_EXT.test(f.name))) { toast(`${f.name}: solo archivos de texto o código`); continue; }
      try { attachments.push({ name: f.name, size: f.size, content: await f.text() }); }
      catch { toast(`No se pudo leer ${f.name}`); }
    }
    renderAttachments();
  }

  /* ---------- exportar ---------- */
  function exportConversation() {
    const c = currentId && conversations.get(currentId);
    if (!c || !c.messages.length) { toast('No hay conversación que exportar'); return false; }
    const data = { app: 'NEXUS AI', exportedAt: new Date().toISOString(), conversation: { title: c.title, createdAt: new Date(c.createdAt).toISOString(), messages: c.messages } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `nexus-${c.title.replace(/[^\w\-áéíóúñü ]+/gi, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'conversacion'}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }

  /* ---------- conectores MCP ---------- */
  function switchEl(checked, onChange, label) {
    const input = h('input', { type: 'checkbox', checked, 'aria-label': label });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, input, h('span', { class: 'slider' }));
  }
  function renderServers() {
    const ul = $('#mcp-list');
    const list = servers.list();
    ul.replaceChildren(...list.map((s) => h('li', { class: 'mcp-item' },
      h('button', { class: 'mcp-info', type: 'button', onclick: () => openServer(s.id) },
        h('span', { class: 'mcp-name' }, s.name),
        h('span', { class: 'mcp-meta' }, s.tools ? `${s.tools.length} herramientas` : 'Herramientas sin consultar')),
      switchEl(s.enabled, (on) => { servers.toggle(s.id, on); renderServers(); }, `Activar ${s.name}`))));
    if (!list.length) ul.append(h('li', { class: 'hint' }, 'Sin conectores. Añade un servidor MCP para darle herramientas a NEXUS.'));
    $('#mcp-count').textContent = String(servers.enabledForTask().length);
  }
  async function inspect(id) {
    const s = servers.get(id); if (!s) return;
    if (!(await checkBackend())) { toast('Conecta Supabase para consultar las herramientas del servidor'); return; }
    try {
      const r = await api.mcpInspect(s.url);
      servers.setTools(id, r && r.tools);
      renderServers(); toast(`${s.name}: ${(servers.get(id).tools || []).length} herramientas`);
      if ($('#mcp-detail').open) openServer(id);
    } catch (e) { toast(`No se pudieron consultar las herramientas: ${e.message}`); }
  }
  function openServer(id) {
    const s = servers.get(id); if (!s) return;
    $('#mcp-detail-name').textContent = s.name;
    $('#mcp-detail-url').textContent = s.url;
    const ul = $('#mcp-tools');
    ul.replaceChildren(...(s.tools && s.tools.length
      ? s.tools.map((t) => h('li', null, h('strong', null, t.name), t.description || 'Sin descripción'))
      : [h('li', { class: 'muted' }, s.tools ? 'Este servidor no expone herramientas.' : 'Aún no se han consultado. Pulsa «Consultar herramientas».')]));
    $('#mcp-inspect').onclick = () => inspect(id);
    $('#mcp-remove').onclick = () => {
      if (!confirm(`¿Eliminar el conector «${s.name}»?`)) return;
      servers.remove(id); renderServers(); $('#mcp-detail').close();
    };
    if (!$('#mcp-detail').open) $('#mcp-detail').showModal();
  }

  /* ---------- configuración ---------- */
  function openSettings() {
    const c = api.loadConfig();
    $('#cfg-url').value = c.baseUrl || '';
    $('#cfg-token').value = c.token || '';
    $('#pref-confirm').checked = prefs.confirmDestructive;
    $('#pref-review').checked = prefs.reviewAgents;
    $('#pref-web').checked = prefs.webSearch;
    $('#pref-auto').checked = prefs.autonomous;
    $('#pref-notify').checked = prefs.notify;
    $('#pref-budget').value = prefs.budgetUsd;
    $('#settings').showModal();
  }
  async function saveSettings() {
    api.saveConfig({ baseUrl: api.normalizeUrl($('#cfg-url').value), token: $('#cfg-token').value.trim() });
    prefs = { ...prefs,
      confirmDestructive: $('#pref-confirm').checked, reviewAgents: $('#pref-review').checked,
      webSearch: $('#pref-web').checked, autonomous: $('#pref-auto').checked,
      notify: $('#pref-notify').checked, budgetUsd: $('#pref-budget').value };
    if (prefs.notify && 'Notification' in window && Notification.permission === 'default') {
      if ((await Notification.requestPermission()) !== 'granted') { prefs.notify = false; toast('Permiso de avisos denegado'); }
    }
    savePrefs(); toast('Configuración guardada');
    resume();
  }

  /* ---------- entrada ---------- */
  function autoGrow() {
    const i = $('#chat-input');
    i.style.height = '56px';
    i.style.height = Math.min(i.scrollHeight, 180) + 'px';
  }

  function init() {
    $('#chat-glow').addEventListener('submit', (e) => { e.preventDefault(); send(); });
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    $('#chat-input').addEventListener('input', autoGrow);
    $('#attach-btn').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
    $('#new-chat').addEventListener('click', newConversation);
    $('#conv-search').addEventListener('input', renderConvList);
    $('#stop-btn').addEventListener('click', stopTask);
    $('#authz-yes').addEventListener('click', () => authorize(true));
    $('#authz-no').addEventListener('click', () => authorize(false));
    $('#term-clear').addEventListener('click', () => {
      const entry = currentId && latestTask(currentId);
      if (entry) { entry.logFrom = entry.state.log.length; updateActivity(); }
    });
    $('#export-input').addEventListener('change', (e) => {
      if (!e.target.checked) return;
      if (!exportConversation()) { e.target.checked = false; return; }
      setTimeout(() => { e.target.checked = false; }, 5000);
    });

    const tier = $('#tier-select'); tier.value = prefs.tier;
    tier.addEventListener('change', () => { prefs.tier = tier.value; savePrefs(); toast(`Nivel de modelo: ${tier.selectedOptions[0].textContent}`); });

    $('#open-settings').addEventListener('click', openSettings);
    $('#open-settings-2').addEventListener('click', openSettings);
    $('#settings').addEventListener('close', () => { if ($('#settings').returnValue === 'save') saveSettings(); });

    $('#add-mcp').addEventListener('click', () => { $('#mcp-form').reset(); $('#mcp-error').textContent = ''; $('#mcp-add').showModal(); });
    $('#mcp-form').addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      try {
        const s = servers.add({ name: $('#mcp-name').value, url: $('#mcp-url').value });
        $('#mcp-add').close(); renderServers(); toast(`Conector «${s.name}» añadido`);
        if (api.isConfigured()) inspect(s.id);
      } catch (err) { $('#mcp-error').textContent = err.message; }
    });

    $('#toggle-sidebar').addEventListener('click', () => { $('#activity').classList.remove('open'); $('#sidebar').classList.toggle('open'); });
    $('#toggle-activity').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#activity').classList.toggle('open'); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); newConversation(); }
      if (e.key === 'Escape') closePanels();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });

    const recent = conversations.all()[0];
    currentId = recent ? recent.id : null;
    renderConvList(); renderMessages(); renderServers(); updateActivity();
    resume();
  }

  init();
})();
