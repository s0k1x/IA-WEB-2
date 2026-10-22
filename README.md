# AURA-X

Plataforma web de agentes de IA para desarrollo de software. HTML, CSS y JavaScript puros, sin instalar nada.

## Cómo usarla
- **Local:** abre `index.html` (para que funcionen la instalación como app y el modo sin conexión, sírvela por http: `python3 -m http.server`).
- **GitHub Pages:** sube todo el contenido de esta carpeta al repositorio (sustituye los archivos anteriores) y espera a que se publique.
- Tus conversaciones de la versión anterior (NEXUS) se migran solas la primera vez que abras la nueva.

## Estructura
- `index.html` — la página.
- `css/styles.css` — sistema de diseño: tema oscuro (por defecto), claro y del sistema; adaptable a móvil.
- `css/components.css` — componentes de Uiverse.io adaptados a la paleta del logo.
- `js/` — `app.js` (interfaz), `api.js` (Supabase), `conversations.js`, `projects.js`, `mcp.js`, `prompts.js`, `backup.js`, `render.js`, `store.js`, `storage.js`, `ui.js`, `palette.js`.
- `icons/` — logo, favicon e iconos de la app. `manifest.webmanifest` y `sw.js` permiten instalarla y abrir la interfaz sin conexión.

## Funciones
- Conversaciones: buscar, renombrar, fijar, archivar, borrar, agrupadas por fecha.
- Proyectos con instrucciones propias; instrucciones personales globales.
- Comandos con `/` (plan, arquitectura, revisar, seguridad, tests, bd, ux, costes, explicar, refactor, docs, bug).
- 10 agentes especializados (automático o elegidos por ti), nivel de modelo, presupuesto por tarea, rondas de revisión.
- Conectores MCP: añadir, activar, consultar herramientas.
- Código de las respuestas: copiar, descargar y vista previa aislada (móvil, tablet y escritorio).
- Adjuntar archivos de texto (clic, arrastrar o pegar), dictado por voz, estimación de tokens.
- Editar y reenviar, regenerar, copiar y borrar mensajes.
- Buscador de comandos (Ctrl/Cmd + K) y atajos (pulsa `?`).
- Panel de actividad con estado real, agente, archivos, errores, consola y costes (reportado / estimado / sin dato).
- Exportar conversación (JSON, Markdown) y copia de seguridad completa (nunca incluye claves).

## Qué necesita Supabase (pendiente de construir)
La página ya envía las tareas, pero responder, trabajar en segundo plano con la página cerrada, usar las herramientas MCP y sincronizar el historial requiere la parte de Supabase (tablas + Edge Function). Hasta entonces, AURA-X avisa de que no hay conexión y no simula respuestas.

En Configuración → Conexión indica la URL del proyecto, la clave **pública** (anon / publishable) y el nombre de la función (por defecto `aura`). AURA-X rechaza claves secretas (`service_role`, `sb_secret_…`).

### Contrato con la Edge Function (`/functions/v1/<nombre>`)
| Método | Ruta | Uso |
|---|---|---|
| GET | /health | comprobar conexión |
| POST | /tasks | crea la tarea → `{taskId, conversationId}` |
| GET | /tasks?active=1 | tareas en curso `[{id, conversationId}]` |
| GET | /tasks/:id/events?since=N | eventos `{seq, type, data, at}` |
| POST | /tasks/:id/answer · /authorize · /cancel | responder · aprobar (`{approve}`) · detener |
| POST | /mcp/inspect | `{url}` → `{tools:[{name, description}]}` |

Cuerpo de `POST /tasks`: `conversationId, prompt, attachments[{name,size,content}], tier, instructions{global,project,projectName}, options{confirmDestructive, reviewAgents, webSearch, autonomous, maxReviewRounds, budgetUsd, agents|null}, mcpServers[{name,url}]`.
Eventos: `status, agent_start, agent_end, file_changed, message, error, handoff, usage`. La función debe responder CORS (OPTIONS y cabeceras `apikey`, `authorization`, `content-type`).

## Límites actuales
- Las conversaciones se guardan en este navegador (límite de unos 5 MB del navegador).
- Los avisos del navegador solo funcionan con la pestaña abierta; los avisos push con la página cerrada necesitan el backend.
- El dictado por voz usa el reconocimiento del propio navegador (en Chrome lo procesa Google).

## Créditos
Componentes visuales basados en Uiverse.io (MIT): Lakshay-art, MuhammadHasann, 3HugaDa3, nazar-gavrylyk, namecho, Kemboi-Dun y kennyotsu.
