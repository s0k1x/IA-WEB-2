# NEXUS AI · Web (HTML, CSS y JS)

## Cómo abrirla
Abre `index.html` en el navegador (no necesita instalar nada) o súbela a cualquier hosting estático.

## Estructura
- `index.html` — la página.
- `css/styles.css` — estilos generales (tema oscuro, adaptable a móvil).
- `css/components.css` — componentes de Uiverse.io adaptados: campo de chat brillante, botón destello,
  casillas neón, interruptores, botón de exportar, terminal e indicador de trabajo.
- `js/app.js` — la interfaz.
- `js/api.js` — conexión con la Edge Function `nexus` de Supabase.
- `js/conversations.js` — conversaciones guardadas en el navegador.
- `js/mcp.js` — conectores MCP (nombre + URL; las claves van como secretos en Supabase).
- `js/render.js` — mensajes con bloques de código, listas y negritas, sin riesgo de inyección HTML.
- `js/store.js` — estado de cada tarea a partir de los eventos reales del servidor.

## Qué funciona ya, sin backend
Conversaciones (crear, buscar, borrar), adjuntar archivos de texto, añadir/activar conectores MCP,
ajustes de agentes y presupuesto, exportar la conversación a JSON y diseño en móvil.

## Qué necesita el backend en Supabase (pendiente)
Respuestas de la IA, trabajo en segundo plano con la página cerrada, consultar y usar las
herramientas de los servidores MCP, historial sincronizado y avisos push.

## Configuración
Botón de engranaje → URL del proyecto (`https://xxxx.supabase.co`) y clave anon (pública).

## Contrato con la Edge Function `nexus`
| Método | Ruta | Uso |
|---|---|---|
| GET | /health | comprobar conexión |
| POST | /tasks | `{conversationId, prompt, attachments, tier, options, mcpServers}` → `{taskId, conversationId}` |
| GET | /tasks?active=1 | tareas en curso, para retomarlas al abrir la página |
| GET | /tasks/:id/events?since=N | eventos `{seq, type, data, at}` |
| POST | /tasks/:id/answer | responder a una pregunta de NEXUS |
| POST | /tasks/:id/authorize | `{approve}` |
| POST | /tasks/:id/cancel | detener |
| POST | /mcp/inspect | `{url}` → `{tools:[{name, description}]}` |

Tipos de evento: status, agent_start, agent_end, file_changed, message, error, handoff, usage.

## Créditos
Componentes visuales basados en Uiverse.io (licencia MIT): Lakshay-art, MuhammadHasann, 3HugaDa3,
nazar-gavrylyk, namecho, Kemboi-Dun y kennyotsu.
