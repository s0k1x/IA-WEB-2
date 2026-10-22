/* NEXUS AI · estado de tareas a partir de eventos REALES del backend (lógica pura) */
(function () {
  'use strict';
  const N = (globalThis.Nexus = globalThis.Nexus || {});
  const TERMINAL = ['completed', 'failed'];
  const STATUS_ES = {
    pending: 'Pendiente', analyzing: 'Analizando requisitos', awaiting_user: 'Esperando tu respuesta',
    planning: 'Planificando', executing: 'Construyendo', reviewing: 'Revisando', testing: 'Probando',
    blocked: 'Bloqueada', awaiting_authorization: 'Esperando autorización', completed: 'Completada',
    failed: 'Fallida', interrupted: 'Interrumpida (recuperable)',
  };
  const MAX_LOG = 300;

  function emptyTask(id) {
    return { id, status: 'pending', agent: null, files: [], messages: [], errors: [], handoffs: 0,
      usage: { reported: 0, estimated: 0, unknownCalls: 0 }, log: [], lastSeq: 0 };
  }
  function isActive(t) { return !TERMINAL.includes(t.status) && t.status !== 'interrupted'; }

  function describe(e) {
    const d = e.data || {};
    switch (e.type) {
      case 'status': return { kind: d.status === 'completed' ? 'ok' : d.status === 'failed' ? 'error' : 'status', text: `estado → ${STATUS_ES[d.status] || d.status}` };
      case 'agent_start': return { kind: 'info', text: `${d.agent} (${d.model}) ${d.action || 'empieza'}` };
      case 'agent_end': return { kind: 'info', text: `${d.agent || 'agente'} terminó` };
      case 'file_changed': return { kind: 'info', text: `archivo modificado: ${d.path}` };
      case 'message': return { kind: 'info', text: `mensaje de ${d.role}` };
      case 'error': return { kind: 'error', text: `error ${d.kind}: ${d.message}` };
      case 'handoff': return { kind: 'handoff', text: `relevo ${d.from || ''} → ${d.to || ''}` };
      case 'usage': return { kind: 'info', text: typeof d.costUsd === 'number' ? `coste ${d.provenance}: $${d.costUsd.toFixed(4)}` : 'coste: sin dato' };
      default: return { kind: 'info', text: `evento ${e.type}` };
    }
  }

  function applyEvent(task, e) {
    if (!e || typeof e.seq !== 'number' || e.seq <= task.lastSeq) return task;
    const t = { ...task, lastSeq: e.seq };
    const d = e.data || {};
    switch (e.type) {
      case 'status': t.status = d.status; break;
      case 'agent_start': t.agent = { name: d.agent, model: d.model, action: d.action || '' }; break;
      case 'agent_end': t.agent = null; break;
      case 'file_changed': t.files = t.files.includes(d.path) ? t.files : [...t.files, d.path]; break;
      case 'message': t.messages = [...t.messages, { role: d.role, text: String(d.text ?? '') }]; break;
      case 'error': t.errors = [...t.errors, { kind: d.kind, message: String(d.message ?? '') }]; break;
      case 'handoff': t.handoffs += 1; break;
      case 'usage': {
        const u = { ...t.usage };
        if (typeof d.costUsd !== 'number') u.unknownCalls += 1;
        else if (d.provenance === 'reported') u.reported += d.costUsd;
        else u.estimated += d.costUsd;
        t.usage = u; break;
      }
      default: break;
    }
    t.log = [...task.log, { at: e.at || new Date().toISOString(), ...describe(e) }].slice(-MAX_LOG);
    return t;
  }

  N.store = { emptyTask, applyEvent, isActive, describe, STATUS_ES, TERMINAL };
})();
