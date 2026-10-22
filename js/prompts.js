/* AURA-X · comandos con "/" y catálogo de agentes especializados */
(function () {
  'use strict';
  const A = (globalThis.Aura = globalThis.Aura || {});

  const SLASH = [
    { cmd: 'plan', title: 'Plan de trabajo', desc: 'Fases, riesgos y prioridades', text: 'Crea un plan de trabajo por fases (con riesgos y orden de prioridad) para: ' },
    { cmd: 'arquitectura', title: 'Arquitectura', desc: 'Componentes, datos y decisiones', text: 'Propón una arquitectura concreta (componentes, datos, flujos y decisiones que requieran mi aprobación) para: ' },
    { cmd: 'revisar', title: 'Revisión de código', desc: 'Errores, riesgos y mejoras', text: 'Haz una revisión crítica de este código: errores, riesgos y mejoras concretas.\n\n' },
    { cmd: 'seguridad', title: 'Auditoría de seguridad', desc: 'Secretos, entradas, RLS, inyección', text: 'Audita la seguridad de lo siguiente (secretos, validación de entradas, autenticación, RLS e inyección):\n\n' },
    { cmd: 'tests', title: 'Escribir pruebas', desc: 'Unitarias e integración', text: 'Escribe pruebas automatizadas (unitarias y de integración) para:\n\n' },
    { cmd: 'bd', title: 'Base de datos', desc: 'Esquema, índices y RLS', text: 'Diseña el esquema de base de datos en PostgreSQL, con índices y políticas RLS, para: ' },
    { cmd: 'ux', title: 'Mejorar UX/UI', desc: 'Cambios de diseño concretos', text: 'Mejora la experiencia de usuario y el diseño de esta pantalla con cambios concretos:\n\n' },
    { cmd: 'costes', title: 'Reducir costes', desc: 'Tokens, llamadas y alternativas', text: 'Estima y reduce el coste de tokens y llamadas de esta tarea, y propón una alternativa económica: ' },
    { cmd: 'explicar', title: 'Explicar', desc: 'Paso a paso y sencillo', text: 'Explícame paso a paso, de forma sencilla, lo siguiente:\n\n' },
    { cmd: 'refactor', title: 'Refactorizar', desc: 'Sin cambiar el comportamiento', text: 'Refactoriza este código manteniendo su comportamiento y explica cada cambio:\n\n' },
    { cmd: 'docs', title: 'Documentación', desc: 'Instalación, uso y límites', text: 'Escribe la documentación (instalación, uso y limitaciones) de: ' },
    { cmd: 'bug', title: 'Corregir un error', desc: 'Causa y cómo comprobarlo', text: 'Encuentra y corrige el error. Explica la causa y cómo comprobar que está resuelto.\n\nSíntoma: ' },
  ];

  const AGENTS = [
    { id: 'arquitecto', name: 'Arquitecto de software', desc: 'Estructura, dependencias y decisiones técnicas' },
    { id: 'frontend', name: 'Programador frontend', desc: 'Interfaces, componentes y accesibilidad' },
    { id: 'backend', name: 'Programador backend', desc: 'APIs, lógica de negocio y tareas largas' },
    { id: 'bd', name: 'Especialista en bases de datos', desc: 'Esquemas, índices, migraciones y RLS' },
    { id: 'ux', name: 'Diseñador UX/UI', desc: 'Flujos, jerarquía visual y usabilidad' },
    { id: 'seguridad', name: 'Especialista en seguridad', desc: 'Secretos, permisos, aislamiento e inyección' },
    { id: 'pruebas', name: 'Ingeniero de pruebas', desc: 'Pruebas automáticas y casos límite' },
    { id: 'costes', name: 'Analista de costes', desc: 'Tokens, presupuesto y modelos económicos' },
    { id: 'producto', name: 'Consultor de producto', desc: 'Prioridades, alcance y valor para el usuario' },
    { id: 'revisor', name: 'Revisor crítico', desc: 'Segunda opinión basada en evidencias' },
  ];

  const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function filterSlash(q) {
    const s = norm(q).replace(/^\//, '').trim();
    if (!s) return SLASH;
    return SLASH.filter((c) => norm(c.cmd).startsWith(s) || norm(c.title).includes(s) || norm(c.desc).includes(s));
  }
  function agentSummary(prefs) {
    if (prefs.agentsAuto) return 'Auto';
    const n = (prefs.agents || []).length;
    return n ? `${n} seleccionado${n === 1 ? '' : 's'}` : 'Ninguno';
  }

  A.prompts = { SLASH, AGENTS, filterSlash, agentSummary, norm };
})();
