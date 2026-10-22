/* AURA-X · datos del usuario guardados en Supabase */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});
  const S = () => A.supa;
  const q = encodeURIComponent;
  const ACTIVE = ['pending', 'analyzing', 'planning', 'executing', 'reviewing', 'testing', 'interrupted'];

  const data = {
    ACTIVE,
    async health() { return S().fn('/health', { method: 'GET' }); },

    // Perfil y ajustes sincronizados
    async loadSettings() { const r = await S().rest(`profiles?id=eq.${S().user.id}&select=settings`); return (r[0] && r[0].settings) || {}; },
    async saveSettings(settings) {
      await S().rest('profiles?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { id: S().user.id, settings, updated_at: new Date().toISOString() } });
    },

    // Proyectos
    projects: () => S().rest('projects?select=id,name,instructions,created_at&order=name.asc'),
    async createProject(name, instructions = '') {
      try { return (await S().rest('projects', { method: 'POST', prefer: 'return=representation', body: { name: name.trim(), instructions } }))[0]; }
      catch (e) { if (e.status === 409 || /duplicate/i.test(e.message)) throw new Error('Ya tienes un proyecto con ese nombre'); throw e; }
    },
    async updateProject(id, patch) {
      try { await S().rest(`projects?id=eq.${id}`, { method: 'PATCH', body: patch }); }
      catch (e) { if (e.status === 409 || /duplicate/i.test(e.message)) throw new Error('Ya tienes un proyecto con ese nombre'); throw e; }
    },
    deleteProject: (id) => S().rest(`projects?id=eq.${id}`, { method: 'DELETE' }),

    // Conversaciones
    conversations: () => S().rest('conversations?select=id,title,project_id,pinned,archived,created_at,updated_at&order=updated_at.desc&limit=300'),
    updateConversation: (id, patch) => S().rest(`conversations?id=eq.${id}`, { method: 'PATCH', body: patch }),
    deleteConversation: (id) => S().rest(`conversations?id=eq.${id}`, { method: 'DELETE' }),
    async searchContent(text) {
      const t = String(text).replace(/[*,()%]/g, ' ').trim(); if (t.length < 2) return [];
      const r = await S().rest(`messages?content=ilike.*${q(t)}*&select=conversation_id&limit=100`);
      return [...new Set(r.map((m) => m.conversation_id))];
    },

    // Mensajes
    messages: (convId) => S().rest(`messages?conversation_id=eq.${convId}&select=*&order=created_at.asc`),
    message: async (id) => (await S().rest(`messages?id=eq.${id}&select=id,content,status,model,updated_at`))[0] || null,
    deleteMessage: (id) => S().rest(`messages?id=eq.${id}`, { method: 'DELETE' }),
    deleteFrom: (convId, createdAt) => S().rest(`messages?conversation_id=eq.${convId}&created_at=gte.${q(createdAt)}`, { method: 'DELETE' }),

    // Tareas
    tasks: (convId) => S().rest(`tasks?conversation_id=eq.${convId}&select=id,status,state,mode,tier,options,assistant_message_id,user_message_id,last_error,created_at&order=created_at.asc`),
    task: async (id) => (await S().rest(`tasks?id=eq.${id}&select=id,status,state,mode,tier,options,assistant_message_id,user_message_id,conversation_id,last_error`))[0] || null,
    activeTasks: () => S().rest(`tasks?status=in.(${[...ACTIVE, 'awaiting_user', 'awaiting_authorization'].join(',')})&select=id,conversation_id,status&limit=50`),
    events: (taskId, since = 0) => S().rest(`task_events?task_id=eq.${taskId}&seq=gt.${since}&select=seq,type,data,created_at&order=seq.asc&limit=300`),
    createTask: (payload) => S().fn('/tasks', { body: payload }),
    answer: (taskId, text) => S().fn(`/tasks/${taskId}/answer`, { body: { text } }),
    authorize: (taskId, approve) => S().fn(`/tasks/${taskId}/authorize`, { body: { approve } }),
    cancel: (taskId) => S().fn(`/tasks/${taskId}/cancel`, { body: {} }),
    mcpInspect: (name, url) => S().fn('/mcp/inspect', { body: { name, url } }),

    // Consumo
    usage: (sinceIso) => S().rest(`model_usage?created_at=gte.${q(sinceIso)}&select=provider,model,input_tokens,output_tokens,cost_usd,provenance,created_at&order=created_at.desc&limit=5000`),

    // Exportar todo
    async exportAll() {
      const [projects, conversations] = await Promise.all([data.projects(), data.conversations()]);
      const out = [];
      for (const c of conversations) out.push({ ...c, messages: (await data.messages(c.id)).map(({ role, content, model, created_at, attachments }) => ({ role, content, model, created_at, attachments: (attachments || []).map((a) => a.name) })) });
      return { app: 'AURA-X', exportedAt: new Date().toISOString(), projects, conversations: out };
    },
  };

  // Agrega el consumo por modelo y por día (procedencia del coste incluida)
  data.summarizeUsage = function (rows, days = 30, now = Date.now()) {
    const byModel = new Map(); const byDay = new Map();
    const tot = { calls: 0, input: 0, output: 0, cost: 0, unknownCalls: 0, freeCalls: 0 };
    for (const r of rows) {
      tot.calls++; tot.input += r.input_tokens || 0; tot.output += r.output_tokens || 0;
      if (r.provenance === 'unknown' || r.cost_usd == null) tot.unknownCalls++; else tot.cost += Number(r.cost_usd);
      if (r.provenance === 'free') tot.freeCalls++;
      const m = byModel.get(r.model) || { model: r.model, provider: r.provider, calls: 0, input: 0, output: 0, cost: 0, unknown: 0 };
      m.calls++; m.input += r.input_tokens || 0; m.output += r.output_tokens || 0;
      if (r.cost_usd == null) m.unknown++; else m.cost += Number(r.cost_usd);
      byModel.set(r.model, m);
      const d = r.created_at.slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + (r.cost_usd == null ? 0 : Number(r.cost_usd)));
    }
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(now - i * 86400000).toISOString().slice(0, 10); series.push({ day: d, cost: byDay.get(d) || 0 }); }
    return { totals: tot, models: [...byModel.values()].sort((a, b) => b.calls - a.calls), series };
  };

  A.data = data;
})();
