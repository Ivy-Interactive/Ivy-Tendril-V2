---
title: Notas de versión
description: Historial de versiones, nuevas funciones, mejoras y correcciones de errores para cada versión de Tendril.
icon: ScrollText
searchHints:
  - notas de versión
  - changelog
  - historial de versiones
  - actualizaciones
  - novedades
---

# Notas de versión

## 2.0.0 (2026-09-21)

Tendril v2 es una renovación arquitectónica generacional de la plataforma Tendril, reescribiendo el daemon y el motor de ejecución central en [Rust](https://www.rust-lang.org), adoptando [Tauri v2](https://tauri.app) para la aplicación de escritorio, introduciendo un frontend de alto rendimiento en [Vite+](https://viteplus.dev) y añadiendo concurrencia nativa de worktrees multi-agente, interacciones de terminal en vivo y [proveedores de modelos](../08_ModelProviders/_Index.md) ampliados.

### Cambios arquitectónicos principales

- **Daemon de Rust de alto rendimiento (`tendril-server` y `tendril-core`)**: Se reemplazó el backend heredado en .NET con un daemon asíncrono en [Rust](https://www.rust-lang.org) impulsado por [Tokio](https://tokio.rs) y [Axum](https://github.com/tokio-rs/axum). El nuevo daemon ofrece despacho de rutas en submilisegundos, agrupación robusta de conexiones [SQLite](https://www.sqlite.org) con tiempos de espera por ocupación (busy timeouts), escrituras atómicas en archivos de configuración y un protocolo de elección de proceso maestro único para IPC local sin sobrecarga.
- **Aplicación de escritorio Tauri v2**: Transición del shell de escritorio a [Tauri v2](https://tauri.app), proporcionando una distribución de escritorio compacta y eficiente en memoria para macOS, Linux y Windows. Aprovecha las vistas web nativas del sistema, puentes IPC reforzados, decoraciones de ventanas nativas e integración en la bandeja del sistema, eliminando las dependencias del marco de ejecución anterior.
- **Frontend Vite+ React**: Se reconstruyó la interfaz de usuario de escritorio desde cero utilizando [Vite+](https://viteplus.dev) y [React 19](https://react.dev). Comparte tokens de diseño atómico y componentes de renderizado con `@ivy-interactive/components`, admitiendo recarga en caliente instantánea, ajustes preestablecidos de temas unificados (Default, Dracula, Forest, Lovably) y diseños responsivos para múltiples puntos de interrupción.
- **Ejecución paralela en worktrees**: Aprovisionamiento automatizado de [git worktree](https://git-scm.com/docs/git-worktree) multirrepositorio para la ejecución concurrente de [planes](../02_Concepts/01_Plans.md). Múltiples [agentes de código](../06_CodingAgents/_Index.md) pueden ejecutar planes independientes simultáneamente en ramas aisladas sin bloqueos de índice git, colisiones de repositorios ni efectos secundarios al cambiar de rama. Incluye un servicio reaper en segundo plano (`worktreeReaperInterval` y `worktreeReaperGrace`) para purgar automáticamente worktrees inactivos o huérfanos.
- **Terminal en vivo y chats interactivos**: Se introdujo la emulación de terminal [PTY](https://en.wikipedia.org/wiki/Pseudoterminal) integrada impulsada por [Xterm.js](https://xtermjs.org) directamente dentro del shell de la aplicación. Los operadores pueden alternar entre chat estructurado e interacción directa en terminal (`chatMode: terminal` o `chatMode: chat`), interactuar con agentes en ejecución a través de stdin, inspeccionar ejecuciones de herramientas transmitidas en vivo y mantener prompts en cola persistentes al cambiar de sesión.
- **Integraciones ampliadas de modelos y sidecars integrados**:
  - **Sidecar OpenCode integrado**: Distribuye el binario CLI de [OpenCode](https://opencode.ai) directamente con el instalador de escritorio (`binaries/opencode`), permitiendo la ejecución sin configuración del [agente OpenCode](../06_CodingAgents/04_OpenCode.md) y el acceso inmediato a cientos de modelos propietarios y de código abierto sin necesidad de instalaciones independientes de Node o CLI.
  - **Traiga su propio LLM (BYO LLM)**: Tarjetas de configuración e incorporación de primer nivel para [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) y el proveedor soberano europeo [Berget AI](../08_ModelProviders/01_Berget.md) (`https://api.berget.ai/v1`), con normalización automática de URL base y envío de credenciales a las variables de SDK de OpenAI y Anthropic.
  - **Integración con Apple Foundation Models**: Compatibilidad nativa con modelos en el dispositivo de Apple a través de `fm serve` en macOS, ejecutando inferencia localmente sin costes de API en la nube y con total privacidad sin conexión.
  - **Enriquecimiento dinámico del catálogo de modelos**: Integra el descubrimiento de catálogos dinámicos desde [models.dev](https://models.dev) con almacenamiento en caché sin conexión en [SQLite](https://www.sqlite.org), detección de datos obsoletos y endpoints de sincronización manual (`POST /api/models/refresh`).
  - **Perfiles de modelos por niveles**: Niveles declarativos de perfiles de modelos (`deep`, `balanced`, `quick`) en todos los [agentes de código](../06_CodingAgents/_Index.md) admitidos ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) y Apple), incluidos selectores configurables de esfuerzo de razonamiento (`low`, `medium`, `high`, `max`).

### Características

- **Terminal PTY integrada para acciones de revisión y agentes**: Ejecute acciones de revisión y sesiones interactivas de agentes dentro de pestañas de terminal con soporte completo de ANSI y seguimiento del árbol de procesos en tiempo real.
- **Gestión de git worktrees multirrepositorio**: Espacios de trabajo de planes aislados estructurados bajo `Worktrees/<owner>/<repo>` con seguimiento de ramas, detección de bifurcación de la rama base ascendente y protección segura contra commits no enviados.
- **Sincronización centralizada con Team Vault**: Conecte, importe y suba configuraciones de proyectos, [servidores MCP](../09_Advanced/03_MCP.md) personalizados y [skills de agente](../06_CodingAgents/00_Skills.md) a vaults remotos respaldados por Git mediante [Team Vault](../09_Advanced/01_CLI/07_Vault.md) con depuración automática de credenciales.
- **Túneles rápidos de Cloudflare (Quick Tunnels)**: Comparta revisiones de planes de solo lectura y el estado de verificación en vivo a través de túneles seguros de [Cloudflare](https://www.cloudflare.com) con códigos QR, protección de sesiones con contraseñas cifradas en [Argon2](https://en.wikipedia.org/wiki/Argon2) y perfiles anónimos de revisor.
- **Editor de configuración en la app**: Editor integrado con resaltado de sintaxis para `config.yaml` con detección de conflictos en vivo, hooks de recarga y acciones de indicaciones guiadas por asistente (consulte [Instalación de configuración](../03_Configuration/01_Setup.md)).

### Mejoras

- **Invocaciones de CLI en submilisegundos**: Se reescribió la CLI `tendril` en Rust (`src/crates/tendril-cli`), logrando un inicio de comandos casi instantáneo y una delegación fluida hacia el daemon (consulte [Descripción general de la CLI](../09_Advanced/01_CLI/00_Overview.md)).
- **Libro mayor de tokens y costes**: Hojas de desglose de tokens y seguimiento de costes en tiempo real por trabajo calibradas en los principales modelos de proveedores, con precios de reserva automatizados para endpoints personalizados.
- **Solucionadores automáticos de verificación**: Ejecutor de verificación estructurado que ejecuta conjuntos de comprobaciones de proyectos (build, test, format, lint) con salida transmitida en vivo y diagnósticos automáticos de fallos (consulte [Comprobaciones de verificación](../09_Advanced/01_CLI/03_Verification.md)).
- **Renderizador unificado de Markdown**: Motor compartido de renderizado de markdown para planes, notas y documentación, compatible con tablas GFM, bloques de código con resaltado de sintaxis, diagramas [Mermaid](https://github.com/mermaid-js/mermaid) y comentarios en línea sobre diffs anclados a caracteres en la [aplicación Review](../04_Apps/02_Review.md).

## 1.2.0 (2026-09-01)

### Características

- **Shell de aplicación rediseñado (Figma)**: Diseño modernizado del shell de escritorio con secciones de navegación plegables, pestañas de sesión persistentes e indicadores integrados de estado del proyecto (`#2173`).
- **Tablero rediseñado de Tendril**: Se construyó el nuevo widget React `TendrilDashboard` con contadores de estado en vivo, tendencias de actividad, seguimiento de trabajos activos y visualización de códigos QR para Cloudflare Quick Tunnel (`#2201`).
- **Unificación de Drafts a Plans**: Se renombraron la aplicación, los servicios y los modelos de Drafts a "Plans" en todo el código base, estableciendo un ciclo de vida cohesivo desde la recepción del issue hasta la ejecución verificada (`#2258`).
- **Subidas HTTP multiparte para adjuntos de chat**: Se reemplazó la transmisión base64 en línea por subidas HTTP multiparte fragmentadas, evitando los límites de carga útil de SignalR en imágenes y archivos grandes (`#2255`, `#2224`).
- **Mensajes en cola persistentes en el chat**: Los mensajes en cola persisten y permanecen visibles al cambiar de sesión de chat, permitiendo poner prompts en cola mientras un agente se encuentra en ejecución (`#2253`).
- **Atajo de búsqueda en la página (Ctrl+F / Cmd+F)**: Se añadió búsqueda en la página dentro de vistas de markdown y planes sin interrumpir el diseño (`#2254`).
- **Vista previa en vivo de Review Actions**: Se añadieron capacidades de vista previa y ejecución para acciones de revisión directamente dentro de la configuración del proyecto (`#2225`).
- **Tema predeterminado Lovably**: Se añadió un tema moderno de interfaz de usuario basado en los tokens de diseño y escalas de color de Lovable (`#2256`).
- **Expansión de CodeInput monoespaciado**: Se integró `CodeInput` con formato de sintaxis en comandos y condiciones de Review Actions (`#2247`), variables de entorno de MCP (`#2248`), prompts de verificación (`#2249`) y contenido markdown de Project Memory (`#2259`).
- **Protecciones para un chat seguro**: Se prohibieron las ediciones directas no verificadas de la base de código dentro de sesiones exploratorias de chat, requiriendo la creación formal de planes para cualquier cambio (`#2221`).
- **Fusión de proyectos de Team Vault en caso de conflicto**: Se añadió resolución inteligente de fusión al importar proyectos de vault que coincidan en nombre con proyectos locales (`#2219`).

### Mejoras

- **Prompts enriquecidos de chat y generación de issues del agente**: Se suministró contexto completo del proyecto, asignaciones de repositorios y metadatos de adjuntos a los prompts iniciales de chat del agente y a la creación de issues en GitHub (`#2226`).
- **Indicadores de modo de tema en ajustes de apariencia**: Se mostraron claramente los estados de modo claro/oscuro activos en la configuración de apariencia (`#2213`).
- **Widget ContentInput adaptativo al tema**: Se adaptaron dinámicamente barras de entrada, botones y bordes en todos los temas preestablecidos personalizados (`#2241`).
- **Simplificación de la tabla de Review Actions**: Se optimizó la tabla de configuración de Review Actions en la configuración del proyecto para mejorar la legibilidad (`#2240`).
- **Compilaciones de código fuente en contenedores de ensayo**: Se configuraron imágenes de Docker de ensayo para compilar directamente desde el código fuente para pruebas precisas de ramas de vista previa de PR (`#2229`).
- **Ajustes de diseño y espaciado de la barra lateral**: Se refinó el espaciado de insignias de verificación completadas y los diseños de generación de sesiones en la barra lateral del chat (`#2220`, `#2223`).
- **Diálogo nativo para eliminar sesión**: Se reemplazó el diálogo emergente modal de React por un widget nativo `DeleteSessionDialog` para la eliminación de sesiones (`#2222`).

### Correcciones de errores

- **Visibilidad de trabajos y rehidratación de la cola**: Se corrigieron tarjetas de trabajos faltantes y se restauraron correctamente los estados de trabajos activos en cola tras reiniciar la aplicación (`#2243`).
- **Limpieza de trabajos bloqueados fantasma**: Se evitó que trabajos bloqueados huérfanos o sustituidos permanecieran en el almacenamiento de SQLite y en las vistas de Output (`#2250`).
- **Tiempos de espera de chat del agente Antigravity**: Se configuraron las sesiones del agente Antigravity para respetar los tiempos de espera globales predeterminados en lugar de agotarse prematuramente (`#2218`).
- **Destino de edición de verificación en ajustes del proyecto**: Se corrigió el diálogo de verificación que apuntaba a la entrada de verificación incorrecta durante las modificaciones (`#2252`).
- **Desbordamiento de bloques de código Markdown**: Se evitó que fragmentos de código anchos se desbordaran horizontalmente en los contenedores primarios de planes (`#2214`).
- **Contraste de temas oscuros Dracula y Forest**: Se resolvieron problemas de visibilidad al pasar el cursor sobre texto e iconos en elementos de la barra lateral, iconos de configuración y pestañas en temas oscuros (`#2210`, `#2211`, `#2212`, `#2239`, `#2242`).
- **Eliminación de barra lateral duplicada**: Se eliminó el renderizado redundante de la barra lateral durante las transiciones del shell de la aplicación (`#2244`).
- **Estado de borrador completado en issues resueltos**: Se resolvió el estado no completable al generar planes para issues resueltos anteriormente (`#2217`).
- **Limpieza de modelos obsoletos**: Se eliminaron referencias obsoletas al modelo Gemini 3.5 Flash en favor de Gemini 3.7 Flash (`#2215`).
- **Limpieza de artefactos de prueba efímeros**: Se aseguró de que las ejecuciones de pruebas end-to-end limpien los directorios temporales y archivos de borrador del agente (`#2209`).

## 1.1.36 (2026-08-28)

### Características

- **Pruebas de modelos en vivo y verificación de autenticación en onboarding**: La incorporación ahora prueba activamente las credenciales de endpoints y los modelos de perfil (`Deep`, `Balanced`, `Quick`) con solicitudes de prueba en vivo antes de permitir la navegación, bloqueando nombres de modelo no válidos y desenvolviendo cargas útiles de error de proxy anidadas en mensajes claros.
- **Constantes de prioridad de perfiles de modelos y enumeraciones de proveedores**: Se reemplazaron las cascadas ternarias por tablas declarativas de prioridades (`ModelProfilePriorities`) y enumeraciones (`ModelProviderKind`, `ModelProfileKind`) para una resolución consistente de modelos predeterminados y candidatos en onboarding y configuración.
- **Despliegue de reserva de promptware bajo demanda**: Se añadió despliegue de reserva automático en `PromptwareRunner` y `PromptwareRunCommand` para extraer promptwares faltantes de recursos incrustados bajo demanda si `Program.md` está ausente.

### Mejoras

- **Prioridad del binario empaquetado de Ivy Agent**: Se reforzó la resolución de binarios `ivy-agent` empaquetados o gestionados por Tendril (`~/.tendril/bin`), evitando que ejecutables del `PATH` del sistema no gestionados interfieran con la ejecución del agente.
- **Persistencia de entradas de modelos personalizados en configuración**: Se corrigió el restablecimiento de nombres de modelos personalizados al presionar Enter o volver a renderizar en `CodingAgentSetupView`.
- **Eliminación de la papelera**: Se eliminó la aplicación obsoleta Trash y su conjunto de comandos, sustituyendo las marcas de papelera por un rechazo limpio de duplicados en `CreatePlan`.

## 1.1.35 (2026-08-28)

### Características

- **Modo túnel compartido y uso compartido externo `[Beta]`**: Comparta de forma segura enlaces a planes y borradores externamente a través de túneles de Cloudflare con generación automática de URL compartidas y acciones de copiado, bajo la marca beta (`beta: true` en configuración o `TENDRIL_BETA`).
- **Protección de sesiones para el modo compartido**: Se añadió protección de sesión mediante contraseña con hash Argon2 en Configuración bajo una sección unificada de "Seguridad y túneles".
- **Perfiles de revisor anónimos**: Se generaron perfiles anónimos amigables con avatares con iniciales para colaboradores externos que revisan planes compartidos.
- **Comentarios en línea sobre diferencias en borradores y planes**: Se añadieron comentarios de revisión en línea en tiempo real sobre bloques de diferencias en el modo Review (`DraftDiffCommentService`) con una acción dedicada "Request Changes" y recuentos en insignias.
- **Anotaciones de selección de texto en borradores**: Se añadió resaltado de selección de texto y ventanas emergentes ancladas a desplazamientos de caracteres en `DraftMarkdown` (`DraftAnnotationService`).
- **Vault de configuración de equipo `[Beta]`**: Se introdujo la sincronización centralizada de configuraciones de equipo respaldada por repositorios Git (`VaultService`, accesible bajo la marca beta), permitiendo a los equipos crear, conectar, importar y subir configuraciones de proyectos a vaults remotos con depuración automática de secretos (`VaultSecretSanitizer`).

### Mejoras

- **Procedencia de trabajos y registro de perfiles**: Se registraron perfiles de ejecución por trabajo y se estructuró la procedencia de las hojas de costes como hechos.
- **Aislamiento de funciones beta**: Se aseguró de que los botones de compartir, los controles de túneles y las configuraciones de vault permanezcan aislados detrás de indicadores beta tanto en la interfaz como en las capas de comandos.

### Correcciones de errores

- **Empaquetado de escritorio para Windows**: Se corrigió el fallo de empaquetado mediante la extracción de zip con rutas limpias para el binario empaquetado `ivy-agent.exe` en compilaciones de Windows x64 y arm64.

## 1.1.34 (2026-08-25)

### Características

- **Terminal PTY integrada para Review Actions**: Las acciones de revisión ahora se ejecutan en una pestaña de terminal integrada y receptiva impulsada por Xterm (`ReviewActionApp`) en lugar de abrir ventanas de terminal externas.
- **CLI empaquetada de Ivy Agent**: Se empaquetó el ejecutable independiente `ivy-agent` directamente con el instalador de la aplicación Tendril, eliminando los requisitos de instalación manual.
- **Traiga su propio LLM (BYO LLM) y catálogos de modelos**: Se añadieron catálogos de proveedores y selectores de modelos para configuraciones de BYO LLM e Ivy Proxy en onboarding y configuración, compatibles con Gemini 3.7 Flash, modelos Claude y modelos de razonamiento OpenAI.
- **Selección de esfuerzo de razonamiento del modelo**: Se introdujeron selectores de nivel de esfuerzo (low, medium, high) para los modelos de razonamiento compatibles en la configuración de perfiles del agente de código.
- **Servidores MCP personalizados y skills de agente**: Se añadió compatibilidad para importar servidores MCP y skills personalizadas directamente desde repositorios Git, URL remotas y rutas de archivos locales, con interfaz de gestión y validación.
- **Hoja de desglose de tokens y costes**: Se introdujeron hojas interactivas de uso de tokens y desglose de costes accesibles directamente desde las celdas de coste en la tabla de Jobs.
- **Organización de worktrees multirrepositorio**: Se estructuraron los worktrees de planes bajo rutas `Worktrees/<owner>/<repo>` para admitir configuraciones de múltiples repositorios y diseños de proyectos complejos.
- **Navegación por teclado y gestión de pestañas**: Se añadió compatibilidad con los atajos `Cmd+W` / `Ctrl+W` para cerrar pestañas activas en la aplicación independiente Tendril, y se perfeccionaron los indicadores de atajos Command (`⌘`) en macOS en todos los diálogos.

### Mejoras

- **Optimización de rendimiento en borradores y revisiones**: Se redujo drásticamente la latencia al cambiar de plan y la sobrecarga al alternar pestañas tanto en la app de Review como en la de Drafts.
- **Escalabilidad de DataTable de Jobs**: Se optimizó el renderizado de DataTable y la sincronización de datos para gestionar fluidamente más de 100 trabajos activos e históricos sin interrupciones visuales.
- **Cola de chat e indicadores de estado**: Se rediseñó el panel de mensajes en cola del Chat con controles en línea y se añadieron insignias de estado de generación en tiempo real en la barra lateral.
- **Anclaje de anotaciones en borradores**: Se anclaron las ventanas emergentes de selección y los resaltados de la barra de herramientas a los desplazamientos de caracteres en `DraftMarkdown` para evitar desplazamientos accidentales al hacer scroll.
- **Visualización de la rama base del worktree**: Se mostraron los puntos de bifurcación de la rama base ascendente en la pestaña Git de Review y se añadió seguimiento de ramas en la vista general de Pull Requests.
- **Supresión de notificaciones emergentes redundantes**: Se suprimieron las alertas toast redundantes dentro de la aplicación cuando ya se muestran notificaciones de escritorio nativas del sistema operativo.
- **Rediseño de la interfaz de configuración**: Se refactorizó el diseño de la configuración del proyecto con muestras de color para proyectos, tarjetas desplegables para skills personalizadas/MCP y tamaño estandarizado de botones.

### Correcciones de errores

- **Protección de commits no enviados en worktrees**: Se evitó que el reaper de worktrees desconecte o elimine commits de planes no enviados durante la limpieza en segundo plano.
- **Fijación del encabezado de llamadas a herramientas**: Se aseguró de que los títulos de llamadas a herramientas del agente permanezcan fijos en la parte superior del visor durante salidas largas transmitidas.
- **Falsos fallos de trabajos tras errores recuperados de herramientas**: Se evitó que los trabajos de Antigravity fallaran erróneamente cuando el agente se recupera con éxito tras un error inicial en una herramienta.
- **Insensibilidad a mayúsculas en URLs de PR de GitHub**: Se admitieron URLs de repositorio sin distinción de mayúsculas y minúsculas (`Https://`, `Git@`, etc.) durante la importación y operaciones de PR de GitHub.
- **Preservación de tramos en el formateador de enlaces Markdown**: Se corrigió el reemplazo de enlaces de planes en el formateador de markdown para evitar que corrompa tramos anidados del plan.
- **Estabilidad del flujo de incorporación**: Se solucionaron bloqueos en la incorporación cuando falla la instalación de un agente o faltan temporalmente los binarios necesarios.

## 1.1.19 (2026-07-28)

### Características

- **Compatibilidad con Claude Opus 5**: Se añadió soporte para el modelo `Claude Opus 5` (`claude-opus-5`) al catálogo de Claude con metadatos de precios actualizados.
- **Cancelación masiva de trabajos**: Se introdujeron las acciones de encabezado "Stop All Jobs" y "Stop All Queued" en `JobsApp` (`IJobService.StopAllJobs` y `StopQueuedJobs`) para la gestión masiva de trabajos.
- **Depuración de memoria de promptware**: Se añadió el comando de CLI `promptware delete-memory` y capacidad de firmware, permitiendo que los promptwares eliminen archivos de memoria obsoletos.
- **Resolución de referencias de memoria**: Resolución automática de referencias de memoria en el comando de CLI `read-memory` en lugar de generar un error cuando se solicitan notas referenciadas.
- **URL de agente Ollama configurable**: Se añadió la opción de URL base configurable (`--url`) para endpoints locales del agente Ollama.
- **Capacidad de importación de issues**: Se amplió el límite del diálogo de importación de issues de 100 a 1.000 issues con advertencias de truncamiento al alcanzar el límite máximo.
- **Persistencia del estado de trabajos en curso**: Se persistieron los trabajos activos en curso en la base de datos SQLite para que las actualizaciones de estado sobrevivan a los reinicios del proceso maestro.
- **Configuración automática del PATH de la CLI en Windows**: Creación automática de scripts de envoltura `tendril.cmd` y registro del directorio de la aplicación en el PATH del usuario de Windows al iniciar la aplicación y en los ganchos del instalador de Velopack.

### Mejoras

- **Consolidación de actualizaciones automáticas por túnel**: Se unificaron las actualizaciones automáticas masivas de la bandeja de entrada y se condicionaron las actualizaciones de celdas de `JobsApp` a cambios reales en los datos, evitando actualizaciones excesivas a través de conexiones de túnel Cloudflare.
- **Optimización de lectura secuencial de agentes**: Se redujo la sobrecarga de inicio de procesos durante las lecturas secuenciales de archivos por parte de los agentes de código.
- **Moneda en el gráfico de costes del tablero**: Se añadieron indicadores de moneda ($) a las series de barras del gráfico de costes en el panel de control.
- **Formateo de la tabla de Jobs**: Se aplanaron los enlaces de markdown y el formato en la columna prompt/título de la tabla de Jobs para una salida tabular más limpia.
- **Salida de CLI en tuberías y compatibilidad con JSON**: Se añadieron alternativas ASCII para el renderizado de tablas de CLI cuando se usan tuberías (pipes) y se introdujo el flag `--json` para `tendril verification list`.
- **Redirección de herramientas heredadas de .NET**: Se añadieron comprobaciones de diagnóstico y redirección automática para enrutar las invocaciones de herramientas heredadas de `.NET` (`ivy-tendril`) a la CLI instalada de Tendril.
- **Rediseño de la documentación**: Se rediseñó `README.md` siguiendo el diseño Orca con GIFs actualizados de las características.

### Correcciones de errores

- **Validación de nombres de proyectos**: Se añadió una validación estricta de nombres de proyectos en la CLI, el diálogo de Configuración y el flujo de incorporación para rechazar nombres no válidos y evitar bloqueos durante la configuración.
- **Sobrecarga de arranque de la CLI**: Se evitó que el servidor Tendril se inicie cuando se pasan argumentos `--help`, `-h` o no reconocidos a `tendril`.
- **Notificación de error 404 en el estado del trabajo**: Se hicieron los endpoints `tendril job status` y `tendril job fail` de mejor esfuerzo (best-effort) en lugar de arrojar errores fatales 404.
- **Advertencia de analizador duplicado**: Se eliminó la referencia duplicada de paquete `Ivy.Analyser` en `Ivy.Tendril.csproj`, eliminando advertencias NU1504, y se actualizó `UpdateIvyPackages.ps1` para editar versiones en el lugar.
- **Ejecución de shell en PlatformHelper**: Se estableció explícitamente `UseShellExecute` en `false` para comandos `open` (macOS) y `xdg-open` (Linux) en `PlatformHelper`.

## 1.1.16 (2026-07-24)

### Características

- **Integración de Ivy Agent**: Se introdujo la integración para el ejecutable independiente Ivy Agent, incluido un instalador CDN de un clic en Configuración, ajustes de URL personalizados para Ivy Proxy y control por bandera beta (`TENDRIL_BETA` o `IVY_BETA`).
- **Selectores de insignias compactos**: Se sustituyeron los selectores de proyecto y prioridad de ancho completo en el cuadro de diálogo Create Plan por botones de insignias compactos con desplazamiento horizontal (widget `BadgeSelect`).

### Mejoras

- **Diagnósticos de DNS de túnel Cloudflare**: Se mostraron mensajes diagnósticos detallados de inicio y conexión para fallos en el túnel de `cloudflared`.
- **Limpieza de la vista de configuración**: Se refactorizaron las entradas de configuración para utilizar propiedades de constructor nativas `.Description(...)` de C# para una mayor coherencia visual.

### Correcciones de errores

- **Superposición del diálogo Add Project**: Se hizo que el botón "New Project" en Create Plan abra el cuadro de diálogo Add Project directamente encima sin cambiar de vista.
- **Análisis sintáctico de URL de túnel**: Se corrigió la extracción de URL del túnel cloudflared ignorando referencias al dominio interno `api.trycloudflare.com`.

## 1.1.14 (2026-07-21)

### Características

- **Documentación de avisos de terceros**: Se añadió `THIRD_PARTY_NOTICES.md` para documentar las licencias de dependencias de terceros empaquetadas.

### Mejoras

- **Estado optimista en ContentInput**: Se implementaron actualizaciones optimistas del estado del texto local en el widget `ContentInput`, posponiendo las actualizaciones de propiedades en segundo plano mientras se escribe para evitar sobrescrituras de entrada.

### Correcciones de errores

- **Descargador de Cloudflared**: Se solucionó un bloqueo durante la configuración en el instalador y descargador automático del binario de `cloudflared`.
- **Análisis de fallos de Codex**: Se corrigió el análisis de fallos del agente de código Codex y la validación del catálogo de modelos.
- **Diseño de configuración de túneles**: Se corrigieron errores tipográficos en los textos y en la disposición de la pantalla de configuración de túneles.

## 1.1.13 (2026-07-20)

### Características

- **Implementación por lotes de recomendaciones**: Selección e implementación por lotes de múltiples recomendaciones a la vez en la app Review.
- **Investigar y debatir con el agente**: Se añadieron botones de acción "Investigate with Agent" y "Discuss with Agent" en Drafts, Review y en la hoja de depuración de trabajos.
- **Comando de CLI para añadir worktrees a planes**: Se añadió el comando de CLI `tendril plan add-worktree` para la gestión simétrica de worktrees.
- **Reejecución de trabajos RetryPlan completados**: Capacidad añadida para volver a ejecutar trabajos `RetryPlan` completados directamente desde la lista de trabajos.

### Mejoras

- **Recarga automática de configuración**: Recarga automática de la configuración ante modificaciones de archivos externos.
- **Resumen y pestañas de Review**: Se renderizó el resumen de Review como DraftMarkdown con tarjeta fija de Verificaciones y se extrajeron las pestañas de Review en vistas dedicadas.
- **Consolidación de registros de trabajos**: Se consolidaron todos los registros de ejecución de trabajos bajo un directorio unificado `<TendrilHome>/Jobs/`.
- **Resaltado de filas en barras laterales y tablas**: Se mejoraron los elementos de lista de la barra lateral y las tablas de datos con estilos de selección de fondo relleno.
- **Actualización del marco de escritorio**: Se actualizaron las dependencias del framework Ivy a la versión 1.3.8 y se configuraron los detalles del diálogo Acerca de en la versión de escritorio.

### Correcciones de errores

- **Preservación del estado al eliminar trabajos**: Se preservó el estado de planes completados al eliminar trabajos finalizados.
- **Renderizado de Markdown y fórmulas matemáticas**: Se solucionó el problema por el cual los signos de dólar en prosa se renderizaban como fórmulas LaTeX y se corrigió el estilo del código en línea en DraftMarkdown.
- **Fuga de semáforo en ranuras de trabajos**: Se corrigió una fuga de semáforo en la asignación de ranuras de trabajos durante fallos de inicio no controlados.
- **Bloqueo en estado de inicio de trabajos**: Se corrigieron trabajos que quedaban bloqueados indefinidamente en estado de inicio añadiendo control de errores en el lanzamiento.
- **Sincronización de commits en worktrees**: Se garantizó que los commits de todos los worktrees de planes se sincronicen correctamente.

## 1.1.12 (2026-07-03)

### Mejoras

- **Solucionadores de verificación de Dotnet**: Se actualizaron las indicaciones de verificación `DotnetBuild`, `DotnetFormat`, `DotnetTest` y `FrameworkDotnetBuild` para ubicar el archivo de solución explícitamente. Se añadieron notas de alcance para configuraciones multirrepositorio, garantizando compilaciones y pruebas confiables.
- **Diseño de interfaz de Pull Request**: Se reordenaron las columnas de la aplicación PullRequest para mostrar primero Plan y último Repositorio, y se redujo el ancho de las columnas Cost y Tokens a 80px para una tabla más compacta y legible.

### Correcciones de errores

- **Intercambio concurrente del cuerpo en CreatePr**: Se corrigió una condición de carrera donde trabajos concurrentes de `CreatePr` podían intercambiar o sobrescribir las descripciones de las pull requests debido a archivos de texto de cuerpo no únicos. Se cambió a `mktemp` para la creación de archivos únicos y se agregaron pruebas de regresión.
- **Carrera en el analizador de eventos compartidos**: Se resolvió una condición de carrera en el análisis de eventos aislando los analizadores por sesión en lugar de compartir instancias. Se añadieron pruebas de regresión para evitar condiciones de carrera futuras en múltiples sesiones.

## 1.1.11 (2026-07-03)

### Correcciones de errores

- **Corrección en el instalador y arranque de macOS**: Se corrigió un problema crítico donde el instalador de macOS (.pkg) se completaba con éxito pero no lograba instalar o iniciar la aplicación debido a enlaces simbólicos rotos y firmas de códigos dañadas durante el reempaquetado. Se reemplazó `pkgutil --expand-full` por `pkgutil --expand` para preservar la integridad de la carga útil de la app, se corrigió el directorio de destino a `1.pkg/Scripts/postinstall` y se reparó un error tipográfico en la ruta del script de confianza del certificado localhost.

## 1.1.10 (2026-07-03)

### Correcciones de errores

- **Notarización del instalador de macOS**: Se corrigió la notarización del instalador de macOS enviando y aplicando correctamente el grapado (staple) al paquete del instalador reempaquetado.

## 1.1.9 (2026-07-03)

### Características

- **Entrada de archivos en Promptware**: Se añadió compatibilidad con la entrada de contenido basada en archivos para comandos de escritura de promptwares, permitiendo a los promptwares ingerir archivos locales durante la ejecución.
- **CLI de recuperación de revisiones de planes**: Se añadió el nuevo comando de CLI `plan get-revision` para recuperar e inspeccionar revisiones históricas de un plan.
- **Política de cambios no rastreados en SyncRepo**: Se añadieron opciones configurables de política de cambios no rastreados (Stash/Commit/PullRequest) para la ejecución de SyncRepo.
- **Graduación de la CLI de Antigravity**: Las integraciones y comprobaciones de la CLI de Antigravity pasaron a estado plenamente estable.

### Mejoras

- **Informes universales de errores**: Se habilitaron los informes de errores para todos los agentes normalizando los modelos de destino a familias admitidas por el backend y añadiendo metadatos originales del agente; se corrigió el informe de errores en macOS recopilando recursivamente los archivos del plan e ignorando tempranamente las carpetas de worktrees.
- **Alternativas de CLI en verificación**: Los comandos `verification` ahora enumeran automáticamente todos los scripts de verificación disponibles si no se encuentra el nombre especificado.
- **Estilos del widget DraftMarkdown**: Se sincronizó el estilo del widget DraftMarkdown con las últimas actualizaciones del sistema de diseño principal.

## 1.1.8 (2026-07-03)

### Características

- **Capacidad de autoactualización de escritorio**: Se implementaron la capacidad y el diálogo de autoactualización, permitiendo que la aplicación de escritorio busque e instale actualizaciones a la última versión automáticamente.
- **Persistencia de la carpeta Tools**: Se preserva el directorio `Tools/` durante las actualizaciones de promptwares y se garantiza que las carpetas de tiempo de ejecución de promptware estén correctamente estructuradas.

### Mejoras

- **Atajo en la aplicación Drafts**: Se añadió el atajo de teclado `Retroceso` (Backspace) para activar la acción Delete en la app Drafts (resolviendo #1507).
- **Espaciado de diseño responsivo**: Se realineó el botón de enlace al issue en el encabezado responsivo para evitar solapamientos y saltos de línea en el texto.

## 1.1.7 (2026-07-02)

### Características

- **Generación de certificados HTTPS para localhost**: Generación y empaquetado automático de certificados SSL/TLS seguros de localhost para aplicaciones de escritorio en macOS y Windows, permitiendo HTTPS local de inmediato.
- **Mejora en el diálogo Create Plan**: Se añadió un enlace directo de acceso rápido "New Project" en el diálogo Create Plan para una incorporación más rápida.
- **Selección de Claude Fable 5**: Se añadió `Claude Fable 5` como opción de modelo seleccionable en las configuraciones de modelos.
- **Integración de CLI de configuración y MCP**: Se añadieron comandos de primer nivel `config get` y `config set` a la CLI de Tendril y a los endpoints del servidor Model Context Protocol (MCP).
- **Experimento FieldToolsDemo**: Se introdujo un nuevo experimento `FieldToolsDemo` para pruebas de desarrollo.

### Mejoras

- **Eliminación optimista de trabajos**: Se hizo que la eliminación de trabajos sea optimista delegando las tareas de limpieza de git worktrees a hilos en segundo plano, logrando una respuesta más rápida en la interfaz.

### Correcciones de errores

- **Flujos de trabajo y scripts de CI**: Se corrigió un error de sintaxis YAML en el flujo de trabajo de publicación, se resolvieron bloqueos en la generación de certificados SSL en los canales de CI y se corrigió un error sintáctico en el script posterior a la instalación en macOS.

## 1.1.6 (2026-07-02)

### Características

- **Notificación de fallos de primer nivel**: Se añadió el comando de CLI `tendril job fail <job-id> --message`, permitiendo a los promptwares informar explícitamente de fallos de ejecución específicos en lugar de depender de códigos de salida y heurísticas sobre la salida estándar.
- **Actualización automática de Inbox**: Se reemplazó el sondeo basado en intervalos en las aplicaciones Drafts, Review, Icebox, Recommendations y Trash por actualizaciones basadas en suscripción mediante un observador del sistema de archivos y estado de procesos con anti-rebote (debounce).
- **Consolidación del actualizador Velopack**: Se consolidó el flujo de autoactualización de escritorio sobre Velopack, habilitando la comprobación de actualizaciones en Configuración, persistiendo las actualizaciones descartadas entre reinicios y eliminando el proyecto obsoleto `Ivy.Tendril.Updater`.
- **Widget UserQuestion**: Se añadió un nuevo widget y visor `UserQuestion` para solicitudes interactivas al usuario.
- **Guía de incorporación**: Se añadió una guía de incorporación de primer nivel a la documentación de Primeros pasos.
- **Mejoras en nuevos planes**: Se añadió un botón de selección de proyecto directamente en el diálogo Create Plan y se renombró `CustomPrDialog` a `CreatePrDialog`.

### Mejoras

- **Seguridad en rutas y shells de Windows**: Se reemplazaron caracteres inseguros para shell (barras verticales y paréntesis) en la configuración de proyecto `stackHash` con `/` y extensiones `.ts`, y se implementó el escape de argumentos de CLI en Windows.
- **Acceso a la red en el entorno aislado del agente**: Se habilitó el acceso a la red en sandbox para Codex mediante el ajuste `sandbox_workspace_write.network_access`, solucionando errores de permiso PermissionError en operaciones de enlace de sockets.
- **Compatibilidad de OpenCode con Ollama local**: Se omitieron las comprobaciones de autenticación y se resolvió la ruta del binario automáticamente al ejecutar OpenCode con un modelo Ollama local, y se cambió a la ejecución `--auto` para evitar bloqueos de PTY.
- **Manejo de enlaces Markdown**: Se centralizó la limpieza de enlaces markdown en revisiones de planes y las comprobaciones de seguridad de renderizado para eliminar anclas de números de línea de URLs de archivos.
- **Nombre de usuario de GitHub en informes de errores**: Se añadió un campo opcional para el nombre de usuario de GitHub en el diálogo de informe de errores y en el comando de CLI `report-bug`.
- **Refinamientos en el diseño de la interfaz**: Se ocultó el panel de códigos QR del túnel en pantallas móviles y tablets, se integró el spinner de carga dentro del cuadro de aviso de inicio, se corrigió el icono del botón "Stop" y se restauró el espaciado en la disposición de acciones de revisión.
- **Desenvolvimiento de texto para Gemini**: Se añadió el desenvolvimiento de saltos de línea duros en el formato de Gemini para mejorar la legibilidad.
- **Estilo de elementos de teclado**: Se añadió estilo para elementos `<kbd>` en el widget de markdown.

### Correcciones de errores

- Se corrigieron trabajos que quedaban bloqueados indefinidamente en la ventana previa al lanzamiento debido a interbloqueos o salidas obsoletas armando los tiempos de espera de inmediato y ejecutando los ganchos previos concurrentemente.
- Se corrigió el restablecimiento abrupto de la posición de desplazamiento hacia arriba en la pantalla Create Plan al cambiar de pestaña.
- Se corrigió el cálculo de costes de trabajos que alcanzaron el tiempo de espera recurriendo a cálculos basados en precios cuando el coste en línea es cero o falta.
- Se corrigió que los planes de CreatePr permanecieran en Drafts cuando los agentes omiten pasos de cierre analizando automáticamente las URL de PR a partir de la salida tras la finalización.
- Se corrigió la saturación de registros de sesión de arranque y el formato de guiones largos en los registros de elección de maestro.
- Se corrigieron errores EPERM al escuchar en el arranque vinculando los servidores de prueba a loopback.
- Se corrigió el colapso a altura cero de la salida del agente Codex durante la ejecución.
- Se corrigieron problemas de foco/desenfoque del teclado y se enfocó automáticamente la entrada cuando se abre el diálogo New Plan.
- Se desactivó la función de túnel no utilizada en la configuración predeterminada.

## 1.1.1 (2026-06-25)

### Características

- **Entrada de voz y planes enriquecidos**: El nuevo widget ContentInput incorpora transcripción de voz y archivos adjuntos al diálogo Create Plan; los archivos se cargan mediante HTTP POST y se guardan junto al plan, con soporte para arrastrar y soltar.
- **Chat con el Agente**: La versión beta de AgentApp le permite chatear directamente con el agente de código a través de un PTY, con un botón "Chat with Agent" en el diálogo New Plan y la CLI `tendril` expuesta al agente a través de un adaptador (shim).
- **Anotaciones en planes**: Realice anotaciones en borradores dentro de DraftsApp para impulsar actualizaciones de planes basadas en anotaciones.
- **Compatibilidad con móviles y tablets**: Tendril ahora es adaptable en puntos de interrupción móviles, tablets y de escritorio, con encabezados, hojas, selectores y visor de procesos adaptativos.
- **Widget DraftMarkdown**: Renderiza diagramas de Mermaid y Graphviz, avisos (callouts), imágenes locales y clickeables, y anotaciones de texto en línea.
- **Actualizaciones automáticas con Velopack**: La aplicación de escritorio se autoactualiza a través de Velopack, con prevención de colisiones en nombres de instaladores.
- **Mapa de calor de actividad**: La vista de Wallpaper muestra un mapa de calor de actividad de PRs completadas durante 90 días.
- **SyncRepo y comprobación previa de repositorio sucio**: Nuevo promptware SyncRepo más una comprobación previa que detecta y resuelve el estado sucio del repositorio antes de Execute y Create Plan.
- **Dependencias de trabajos**: Bloqueo a nivel de trabajo mediante `WaitForJobs` con fallo en cascada, reevaluación periódica de trabajos bloqueados y una acción Force Start para trabajos bloqueados.
- **Reejecutar con comentarios**: Vuelva a ejecutar un trabajo proporcionando comentarios adicionales para el agente.
- **Revertir revisión**: Revierta una revisión específica del plan directamente desde la pestaña Details.
- **Reaper de worktrees obsoletos**: Limita el uso de disco de worktrees eliminando aquellos obsoletos dejados por ejecuciones anteriores.
- **IPC CLI/servidor basado en HTTP**: La CLI y el servidor se comunican a través de HTTP con elección de maestro para una coordinación confiable de una sola instancia.
- **Tiempos de ejecución empaquetados**: El SDK de .NET 10 y PowerShell 7 se empaquetan en instaladores y se resuelven dinámicamente en tiempo de ejecución cuando están presentes.
- **Protecciones de repositorio**: Los planes están protegidos contra su ejecución o fusión en repositorios ajenos a su proyecto, y la rama predeterminada del repositorio se detecta automáticamente en lugar de asumir `main`.
- **Marco de migración de planes**: Se añadió `schemaVersion` a `plan.yaml` junto con un marco de migración de planes por archivo.
- **Variables de entorno para agentes de código**: Configure variables de entorno por agente en los ajustes de Coding Agent.
- **Comando `tendril agent-instructions`**: Genera las instrucciones del agente desde la CLI.

### Mejoras

- **Perfeccionamiento de túneles**: Estados de conexión claros, código QR en pantalla de inicio, Open in Browser, detección de enrutabilidad antes de estar conectado, limpieza de procesos huérfanos de `cloudflared` y desactivación con un solo clic con interfaz optimista.
- **Verificaciones como única fuente de verdad**: `plan.yaml` es ahora la fuente de verdad para verificaciones, con una tarjeta de interfaz dedicada, enumeración de estados y ordenación por arrastrar y soltar en el diálogo de edición del proyecto.
- **Hoja de depuración de trabajos (Job Debug)**: Se añadieron directorio de trabajo y argumentos de CLI, botones de copia para identificadores de Plan/Job, un botón Report Bug y aprendizajes de promptware (escrituras en memoria/herramientas); oculta filas vacías y denegaciones de permisos.
- **Renombramiento de estados de planes**: `Building → Creating` y `ReadyForReview → Review` para una nomenclatura de ciclo de vida más clara.
- **Consolidación de CLI**: Registro por un único canal, propagación unificada de excepciones, salida descriptiva de estados de trabajos y puntos de conexión Web API/MCP añadidos para paridad total con la CLI.
- **Recomendaciones simplificadas**: Se eliminó el campo Risk de las recomendaciones en toda la interfaz y en los prompts.
- **App independiente en macOS**: Carga robusta de PATH y entorno desde el shell de inicio de sesión, detección adecuada de apps empaquetadas y creación automática del enlace simbólico global `tendril`.
- **Reestructuración de widgets**: Se consolidaron los widgets en un proyecto unificado `Ivy.Tendril.Widgets` con directorios de frontend por widget.
- **Flujo de autofusión**: El flujo de CI fusiona automáticamente `main` nuevamente en `development` después del lanzamiento.
- **Seguridad en dependencias**: Se actualizó `SQLitePCLRaw.lib.e_sqlite3` a la versión 3.50.3 y se fijaron las dependencias de frontend (dompurify, vite-plus) para resolver vulnerabilidades conocidas.

### Correcciones de errores

- Se corrigió el análisis de argumentos con guiones en `tendril plan create`.
- Se corrigieron errores de SQLite "database is locked" mediante una factoría compartida de conexiones y `busy_timeout`.
- Se corrigió que trabajos cancelados/detenidos/fallidos revirtieran los planes a su estado anterior.
- Se corrigió la fusión de PR que dependía de una regla `prRule` desactualizada en lugar del indicador `PrMerge`.
- Se corrigió que los borradores no se actualizaran tras cambios.
- Se corrigieron fallos intermitentes al crear PR y mensajes de error engañosos.
- Se corrigió que no se renderizara el relleno izquierdo de markdown en Review y Drafts.
- Se corrigió que el orden de las verificaciones no persistiera en el diálogo Edit Project.
- Se corrigió el cálculo del coste del trabajo para que se ejecute en todos los estados utilizando datos de resultados en línea.
- Se corrigió una condición de carrera de escritura perdida en `plan.yaml` al aceptar una recomendación.
- Se corrigió un bloqueo al navegar a Drafts/Review con un plan no válido.
- Se corrigió una condición de carrera en el desbloqueo de `WaitForJobs` y en la detección de trabajos duplicados.
- Se corrigió que IvyFrameworkVerification dejara procesos zombi tras ejecuciones de prueba.
- Se corrigieron bloqueos en el análisis de métricas de uso de Copilot implementando un análisis defensivo.
- Se corrigió el bloqueo de Spectre.Console causado por formato sin escapar en la salida del comando doctor.
- Se corrigió el fallo de arranque en la incorporación en macOS y Windows cuando `TENDRIL_HOME` está vacío.
- Se corrigió la opción predeterminada duplicada en los menús desplegables de modelos de perfiles de agentes de código.
- Se corrigió el icono faltante en la barra de tareas de Windows.
- Se corrigieron permisos ACL en la carpeta de planes que bloqueaban ExecutePlan.
- Se corrigió la puesta en cola de trabajos SyncRepo duplicados para el mismo repositorio.
- Se corrigió la colisión de nombres de ContentInput después de que el marco agregara su propio widget.
- Se corrigió el error `SyntaxError` de JS en versiones antiguas de WebKit apuntando a es2020.

## 1.0.39 (2026-05-28)

### Características

- **Proveedor de agentes Gemini**: Se añadió Gemini CLI (`gemini`) como agente de código compatible, con comprobación completa de estado, autenticación y seguimiento de costes por sesión.
- **Soporte de túneles**: Acceso remoto a través de túneles de Cloudflare con código QR en Configuración, detección automática de servidor listo y comprobaciones de enrutabilidad antes de la conexión.
- **Diálogo de prueba de agentes**: Nuevo botón Test Agent en Configuración que ejecuta automáticamente comprobaciones de instalación, autenticación y modelos para todos los agentes configurados.
- **Selección de modelo por perfil**: Posibilidad de elegir modelos específicos por perfil de esfuerzo (deep/balanced/quick) en la configuración de Coding Agent.
- **Catálogos de modelos por proveedor**: Se reemplazó el archivo global `models.yaml` por catálogos específicos por proveedor y un comando de CLI `tendril models`.
- **Comando `tendril update`**: Autoactualización mediante el actualizador gráfico Photino.
- **Inyección de plantillas de planes**: Las plantillas de planes se inyectan en el firmware; el modelo real utilizado se registra por trabajo.
- **Títulos legibles de herramientas**: Campo de descripción en ToolCallWire para una visualización más clara de la salida del agente.
- **Acceso aislado a archivos para agentes**: Los agentes obtienen permisos de escritura en TENDRIL_HOME, carpetas de planes y de promptware.
- **Opción `--search` para listar planes**: Filtre planes por términos de búsqueda desde la CLI.
- **AgentApp con prompt de sistema**: Aplicación beta de chat con agente con el prompt de sistema de Tendril inyectado.
- **Crear plan desde la pantalla de inicio**: El botón New Plan en la pantalla de inicio abre directamente el CreatePlanDialog.
- **Botón para copiar todos los detalles**: Copie los detalles completos de depuración del trabajo al portapapeles en la hoja Job Debug.
- **Extracción de vista de boletín informativo**: Componente compartido de boletín informativo con mejores informes de errores.

### Mejoras

- **División de configuración**: La configuración general se dividió en las pestañas Coding Agent, Plans y Appearance.
- **Renombramiento de PlansApp a DraftsApp**: Se actualizaron la insignia de la barra lateral y la navegación correspondiente.
- **Diseño de configuración de agentes de código**: Diseño mejorado con nombres visibles y gestión de modelos predeterminados para todos los proveedores.
- **Perfeccionamiento de la CLI**: Formateador de consola limpio, soporte para `--help` sin iniciar el servidor, mensaje de error claro para comandos desconocidos y formato mejorado para la salida de doctor.
- **Perfeccionamiento de AgentOutputView**: Tarjetas de herramientas con salida sin saltos forzados, títulos más claros, espaciado uniforme y estado oculto al completarse.
- **Mejoras en la vista de procesos**: Botones de igual ancho, pulso gris, tokens de color semántico para modo oscuro y hook deduplicado.
- **Widget TendrilProcessView**: Añadido a la solución con soporte para modo oscuro mediante tokens de color semántico.
- **Mejoras en los scripts de instalación**: Verificación de la ejecución de git, adición prioritaria de .NET 10 al PATH y scripts más limpios.
- **Seguridad en dependencias**: Se fijaron rangos de versiones de dependencias a versiones exactas para prevenir ataques de secuestro y confusión.
- **Validación de rama base**: Impide añadir proyectos con ramas base no válidas o repositorios locales no válidos.
- **Salida sin procesar del agente**: Escrita en `.raw.jsonl` en lugar del formato EventWire para facilitar la depuración.
- **Mejoras en Copilot**: Se cambió a prompt por stdin debido al límite de longitud de comandos en Windows, alternativa a `gh copilot` cuando el binario independiente no está en el PATH y análisis del formato JSON actualizado.
- **Widget CodeBlock**: La salida y resolución del agente utiliza CodeBlock en lugar de Markdown directo.
- **Organización de servicios**: Servicios refactorizados en subdirectorios; constantes de estado extraídas.

### Correcciones de errores

- Se corrigió que la vista de procesos mostrara recuentos invertidos de planes en actualización y en ejecución.
- Se corrigió la resolución de rutas en la incorporación cuando el parámetro tendrilHome está vacío.
- Se corrigió la pantalla de carga infinita "Setting up agent" en la incorporación.
- Se corrigió la actualización de migración de base de datos de 10 a 11 haciendo que la migración 11 sea idempotente.
- Se corrigieron las barras invertidas en archivos .csproj y la búsqueda de rutas de Promptwares en la incorporación.
- Se corrigieron bloqueos de procesos de Copilot con un tiempo de espera de STDIN de 5 segundos.
- Se corrigió la llamada faltante a ResolveCommandShim en PromptwareRunner.
- Se corrigió el límite de longitud de línea de comandos al iniciar Gemini.
- Se corrigió que los eventos `item.updated` de Codex emitieran UnknownEvent.
- Se corrigieron los modelos predeterminados para perfiles de Copilot y Codex en instalaciones nuevas.
- Se corrigió la clave de insignia de la barra lateral de "plans" a "drafts" tras el renombramiento.
- Se corrigieron encabezados y estilos duplicados en el diálogo Add Project.
- Se corrigió el desfase de índices en el diálogo de edición tras añadir un proyecto.
- Se corrigió que el menú desplegable de modelos no mostrara la opción Default.
- Se corrigió la resolución de comandos PTY en Windows a la extensión .cmd.
- Se corrigieron modelos nulos durante el cambio de agente.
- Se corrigió el prefijo "undefined:" en los mensajes de estado de trabajos.
- Se corrigió que nombres de proyectos duplicados bloquearan la incorporación.
- Se corrigió el análisis de salida sin procesar del agente a EventWire en tiempo real durante la incorporación.
- Se corrigió la ventana adicional y el icono faltante en la barra de tareas al iniciar la aplicación en Windows.
- Se corrigió que no se renderizaran los resultados de herramientas en AgentOutputView.
- Se corrigió el análisis de resultados de herramientas de Claude Code a partir de mensajes de usuario.
- Se corrigió el error 502 de cloudflared leyendo la dirección real del servidor.
- Se corrigió que OpenCode omitiera el flag --model cuando `model: default`.
- Se corrigieron eventos intermedios step_finish de OpenCode en la vista de salida.

## 1.0.35 (2026-05-20)

### Características

- **Notificaciones toast nativas del SO**: Notificaciones de escritorio para finalizaciones de planes, fallos y otros eventos, con una pestaña dedicada a Notificaciones en Configuración.
- **Insignia en la barra de tareas**: Recuento de trabajos activos mostrado en la insignia de la barra de tareas para conocer el estado de un vistazo.
- **Asistente paso a paso para añadir proyectos**: La configuración de nuevos proyectos ahora utiliza un asistente guiado similar al de incorporación, con opción de omitir para usuarios experimentados.
- **Comando de CLI para mover verificaciones**: Reordene verificaciones mediante `tendril project move-verification` con instrucciones de ordenación.
- **Incorporación rediseñada**: "Your First Project" es ahora un flujo de 3 pasos con configuración de proyecto limpia, comentarios progresivos y suscripción al boletín informativo al completarse.
- **Comandos CRUD en la CLI**: Soporte completo de operaciones CRUD para verificaciones y proyectos a través de la CLI (`tendril project get`, `tendril verification add/remove/move`).
- **Sincronización de commits de planes**: Sincronice commits de planes bajo demanda mediante el botón Synchronize en Review.
- **Interfaz CRUD para ReviewAction**: Configure acciones de revisión directamente desde Configuración e incorporación.
- **Comando `tendril reset`**: Restablezca el estado de Tendril a través de la CLI.
- **Comando `tendril report-bug`**: Envíe informes de errores con contexto del sistema directamente desde la CLI.
- **Comando `promptware read-memory`**: Inspeccione la memoria de promptwares desde la CLI.
- **Modo borrador para la creación de PR**: Opción para crear pull requests como borradores de GitHub.
- **Aceptar/Rechazar recomendaciones**: Acepte o rechace recomendaciones directamente en la app Review, con filtrado por planes completados.
- **Pestaña Git: Ficha de worktrees**: Muestra detalles del repositorio principal y agrupa los commits en secciones por worktree.
- **Mantener worktrees activos para planes fallidos**: Los worktrees de planes fallidos se conservan para depuración en lugar de eliminarse.
- **Proveedor de agentes OpenCode**: Se añadió OpenCode como agente de código compatible.
- **Proveedor de agentes Copilot CLI**: Se añadió la CLI de GitHub Copilot como agente de código compatible.
- **Flag de CLI `--plans-dir`**: Permite anular el directorio de planes para pruebas E2E y configuraciones personalizadas.
- **Widget TendrilProcessView**: Widget externo para visualizar los procesos de Tendril.

### Mejoras

- **Perfeccionamiento de la pestaña Git**: Iconos en los encabezados de sección y en estados vacíos, árbol jerárquico con indicadores de color para archivos modificados.
- **Estabilidad de la pestaña Cambios**: Se corrigieron parpadeos durante la revalidación en segundo plano cada 30 segundos, comportamiento desplegado por defecto y diseño de ancho completo.
- **Limpieza de la pestaña Review**: Las pestañas vacías de Artefactos y Recomendaciones ahora se ocultan; las vistas de planes utilizan tipografía de estilo artículo.
- **Simplificación de mensajes de commit**: Se eliminó el prefijo del ID del plan de las instrucciones de mensajes de commit para un historial de git más limpio.
- **Mejora en la importación de issues desde GitHub**: Experiencia de usuario perfeccionada para el flujo de importación de issues de GitHub.
- **Dimensionamiento de ventanas**: Se actualizaron las dimensiones predeterminadas de las ventanas para pantallas Retina de macOS, estableciendo un tamaño mínimo obligatorio.
- **Mejoras en RetryPlan**: Añade secciones de corrección al resumen existente, clarifica la configuración de worktrees multirrepositorio y transmite el registro en bruto al disco.
- **Eliminación de VerbosityService**: Reemplazado por niveles estándar de ILogger para una configuración de registros más sencilla.
- **Extracción de ServiceRegistration**: Los registros de servicios se trasladaron de TendrilServer a un archivo dedicado `ServiceRegistration.cs`.
- **Salud del código en la incorporación**: Se extrajeron funciones auxiliares, se añadió AgentOnboardingInfo, constructores primarios y se mejoraron los textos descriptivos de la experiencia.
- **Permisos de herramientas en Promptware**: Se actualizaron los permisos predeterminados de herramientas para una ejecución de agentes más segura.
- **Reestructuración de la documentación de la CLI**: Reescribitura integral de la referencia de la CLI con sintaxis de comandos y ejemplos actualizados.
- **Markdown de ancho completo en vistas de planes**: Contenido con desplazamiento y restricción de ancho máximo para una mejor legibilidad.
- **Tabla de Jobs responsiva**: Densidad amplia en tabletas y media en escritorio para un mejor aprovechamiento del espacio.
- **Eliminación de generación automática de verificaciones**: Se eliminó del diálogo de edición de proyectos en favor de la gestión de verificaciones mediante la CLI.
- **Ocultamiento de excepciones internas del marco**: Las excepciones internas del marco ya no se muestran como notificaciones dirigidas al usuario.

### Correcciones de errores

- Se corrigió que restablecer a borrador no actualizara la interfaz de inmediato tras la confirmación.
- Se corrigió que el orden de verificación del proyecto no se preservara en el paso de revisión de la incorporación.
- Se corrigieron pasos de la incorporación bloqueados después de que se completara el progreso.
- Se corrigió el destello de "No summary available" al abrir un plan en Review.
- Se corrigió el parpadeo de la pestaña Cambios cada 30 segundos durante la revalidación en segundo plano.
- Se corrigió la paralelización de pruebas que contaminaba el archivo `config.yaml` de TeamIvyConfig.
- Se corrigieron los hashes de commits almacenados como cortos en el sincronizador; ahora almacena hashes completos y refresca la interfaz tras sincronizar.
- Se corrigió la pérdida de commits entre ejecuciones de RetryPlan.
- Se corrigieron las rutas de comandos de acciones de revisión para usar sintaxis de comillas de PowerShell.
- Se corrigió la notificación de error al cancelar diálogos con la tecla ESC.
- Se corrigió la migración de mayúsculas/minúsculas en subcarpetas y pruebas de limpieza rotas.
- Se corrigió la corrupción de `plan.yaml` durante la ejecución de UpdatePlan.
- Se corrigió el contenido duplicado en Agent Output durante la transmisión en vivo.
- Se corrigió que la salida del trabajo se renderizara dos veces al completarse el trabajo.
- Se corrigió un error en la resolución de PromptwareRoot que provocaba la falta de promptwares.
- Se corrigió el espaciado y la posición del aviso emergente Update Available.
- Se corrigió el mensaje incompleto "You have ." en WallpaperApp.
- Se corrigió el icono faltante de la ventana de la aplicación actualizando los nombres de los recursos.
- Se corrigió el fallo de `gh auth status` cuando existen múltiples cuentas de GitHub.
- Se corrigió que la hoja de salida mostrara un panel vacío para trabajos completados.
- Se corrigió un ReportedPlanId ficticio cuando no existe una carpeta de plan coincidente.
- Se corrigió la ordenación de la tabla de Jobs para mostrar primero los trabajos más recientes.
- Se corrigió que los trabajos completados se filtraran al reiniciar.
- Se corrigió la sintaxis de invocación delegada de verificaciones que causaba fallos en IvyFrameworkVerification.
- Se corrigió el bloqueo indefinido del botón Complete Setup en la incorporación.
- Se corrigió el bloqueo infinito en el arranque del servicio en segundo plano.
- Se corrigió el problema de alcance en los nombres de pestañas en Review.

## 1.0.22 (2026-04-27)

### Mejoras

- **Manejo de errores con GitResult\<T\>**: Se introdujo el tipo de retorno tipado `GitResult<T>` en GitService para un manejo de errores explícito y uniforme sin excepciones.
- **Extracción de DashboardRepository**: Se extrajo `GetDashboardData` en un DashboardRepository dedicado, separando el acceso a datos de la lógica empresarial.
- **Interfaz ISessionParser**: Se extrajo el análisis de sesiones detrás de una interfaz `ISessionParser` para facilitar pruebas y variantes futuras del analizador.
- **Extracción de PlanYamlRepairService**: Se trasladó la lógica de reparación de YAML de planes y la eliminación de worktrees a servicios dedicados (`PlanYamlRepairService`, `WorktreeCleanupService`).
- **Extracción de AppShellRouter**: Se extrajo la lógica de enrutamiento de `OpenApp` en una clase dedicada `AppShellRouter`.
- **Implementaciones de IDoctorCheck**: Se refactorizaron las comprobaciones diagnósticas de doctor en clases individuales `IDoctorCheck` para mayor extensibilidad.
- **Autenticación MCP centralizada**: Se consolidó la autenticación de herramientas MCP en un solo servicio.
- **Protección BackgroundServiceActivator**: Se añadió detección y recuperación ante la terminación silenciosa de procesos en segundo plano.
- **Patrón IDisposable en PlanDatabaseService**: Limpieza adecuada de recursos para conexiones de base de datos.
- **SoftwareCheckStepView asíncrono**: Se reemplazaron las llamadas bloqueantes `.Result` por `await` para una interfaz receptiva durante las comprobaciones de salud.
- **Pase integral de optimización de código**: Se redujo la complejidad ciclomática en ContentView, PlanController, PlanTools, ConfigService, GithubService, JobLauncher, ModelPricingService, TendrilAppShell y GetPromptDisplay mediante extracción de métodos y refactorizaciones orientadas a datos.
- **Infraestructura de pruebas**: Se añadieron patrones `TempDirectoryFixture`, `ConfigServiceFixture`, `DatabaseFixture` y `IClassFixture`; se amplió la cobertura de pruebas para GitService, PlanValidationService, JobLauncher y asignación de PlanId.
- **Ventana de 7 días en el tablero**: Los recuentos de estado y de proyectos en el panel de control ahora se filtran a los últimos 7 días.

### Correcciones de errores

- Se corrigió una condición de carrera en la asignación de PlanId centralizando la asignación en JobService.
- Se corrigió que `ModifyPlanEndpoint` devolviera tipos de resultado incorrectos.
- Se corrigió la discrepancia en el tipo de registrador de `DashboardRepository`.
- Se corrigió el cierre automático de issues de GitHub trasladando la referencia `Closes` después del truncamiento del cuerpo.
- Se corrigió una condición de carrera en el renombramiento de archivos en `InboxWatcherService`.
- Se corrigió el manejo de parámetros que aceptan valores nulos en `IsValidCommitHash`.
- Se corrigió el manejo de excepciones en la tarea de seguimiento de costes.
- Se corrigió el acceso al proveedor de servicios en `Program.cs`.
- Se corrigió la referencia a `TabState` en `AppShellRouter` y los modificadores de acceso a métodos controladores.
- Se eliminó el bloqueo de concurrencia de repositorios de JobService.
- Se eliminó `DashboardLoggerAdapter`, utilizando el registrador directamente.
- Se añadió registro a excepciones ignoradas en todos los servicios.
- Se corrigieron configuraciones de CI/Docker: Node.js v22, manejo adecuado de `IvySource`, eliminación de referencias obsoletas a Ivy-Framework.

## 1.0.14 (2026-04-10)

### Características

- **Cola de prioridad de trabajos**: Los planes ahora se ejecutan en orden de prioridad. Los planes de tipo error (Bug) se ejecutan antes que NiceToHave, garantizando que las correcciones críticas se procesen primero.
- **Importar issues desde GitHub**: Importe issues existentes de GitHub directamente en Tendril como borradores de planes a través del nuevo diálogo de importación.
- **Creación de planes multiproyecto**: El diálogo Create Plan ahora admite la selección de múltiples proyectos, agrupando sus repositorios en un único plan.
- **WorktreeLifecycleLogger**: Registro de auditoría centralizado para eventos de creación, limpieza y fallo de worktrees en PlanReaderService, WorktreeCleanupService y JobService.
- **Pestaña de ajustes avanzados**: Nueva pestaña en Configuración para definir opciones de nivel inferior.

### Mejoras

- **Comentarios progresivos de comprobación de salud**: Las comprobaciones de salud ahora transmiten resultados individuales a medida que se completan en lugar de esperar a que finalicen todas.
- **Estado de PR guardado en SQLite**: El estado de fusión de las PR se almacena en caché en la base de datos local con un servicio de sincronización en segundo plano, reduciendo llamadas a la API de GitHub.
- **PlanWatcher simplificado**: Se reemplazó el uso intensivo de FileSystemWatcher por un enfoque más simple para evitar el desbordamiento del búfer debido a la actividad de los worktrees.
- **Registro diagnóstico de worktrees**: Se añadieron comprobaciones de detección temprana de archivos `.git` faltantes y se mejoraron los mensajes de error en caso de fallo al crear worktrees.
- **Detección recursiva de artefactos de worktrees**: ExecutePlan ahora detecta y elimina artefactos de worktrees anidados que quedaron en el directorio Plans de ejecuciones previas.
- **Acceso defensivo a diccionarios**: MakeSoftwareRow utiliza `GetValueOrDefault` para evitar excepciones KeyNotFoundException en casos límite.

### Correcciones de errores

- Se corrigió la comprobación de salud de Gemini que abría ventanas de navegador durante la autenticación.
- Se corrigió la comprobación `anyAgentHealthy` para utilizar el estado de instalación del agente Gemini.
- Se corrigió la capacidad de prueba del constructor de ConfigService.
- Se corrigieron errores de análisis de YAML en `recommendations.yaml`.
- Se eliminó la directiva redundante Watch Remove de `Ivy.Tendril.csproj`.
- Se eliminó `_prStatusCache` no utilizado de GithubService.

## 1.0.12 (2026-04-10)

### Características

- **Compatibilidad multi-agente**: Tendril ahora admite múltiples agentes de código (Claude, Codex, Gemini) con perfiles configurables (deep, balanced, quick) por agente.
- **Instalador para Windows**: Nuevo script `install.ps1` para una instalación simplificada en Windows.
- **Comando doctor**: Ejecute `tendril doctor` para diagnosticar problemas en el entorno y la configuración.

### Mejoras

- **Renovación integral de la documentación**: Reescribitura exhaustiva de toda la documentación de Tendril con mejoras en estructura, ejemplos y flujo de incorporación.
- **Perfeccionamiento del asistente de incorporación**: Interfaz de usuario, textos y disposición de pasos mejorados para la experiencia de primera ejecución.
- **Promptwares independientes de la tecnología**: Se eliminaron referencias específicas de frameworks o pilas técnicas de ExecutePlan, CreatePlan y otros promptwares para admitir cualquier pila mediante verificaciones en `config.yaml`.
- **Sustitución de FolderInput por TextInput**: Se simplificó la entrada de rutas en todas las aplicaciones de Tendril.

### Correcciones de errores

- Se corrigió el manejo de la variable de entorno `TENDRIL_HOME` en las pruebas.
- Se añadió manejo de errores a `PlatformHelper.OpenInTerminal` y `OpenInFileManager`.
- Se añadió comprobación `File.Exists` antes de leer `plan.yaml` en PlanReaderService.

## 1.0.9 (2026-04-09)

### Características

- **Lanzamientos estables en NuGet**: Tendril ahora publica paquetes NuGet versionados y estables utilizando `Directory.Build.props` para una gestión centralizada de versiones.
- **Base de datos SQLite**: Almacenamiento de datos local para planes, trabajos y estado de PR con compatibilidad para migraciones.
- **Sistema de recomendaciones**: Los planes ahora pueden generar recomendaciones de seguimiento que se muestran en la app Recommendations.
- **Gestión del ciclo de vida de planes**: Máquina de estados completa para planes: Draft, Approved, Executing, Review, Completed, Failed, con transiciones automáticas.

### Mejoras

- **Seguimiento de costes**: Seguimiento de costes y tokens por trabajo con visualización en el tablero por proyecto y tipo de promptware.
- **Enumeración exhaustiva de estados de trabajos**: Soporte de conversión a cadenas para todos los estados de trabajos.
- **Mejoras en el manejo de errores**: Detección de versiones de migración duplicadas y control de errores en FTS5.

## 1.0.0 (2026-04-03)

### Características

- **Lanzamiento inicial** del sistema de gestión de planes de Tendril.
- **Aplicaciones de planes**: Vistas de Dashboard, Review, Drafts, Jobs, Icebox, Pull Requests, Recommendations y Trash.
- **Promptwares**: CreatePlan, ExecutePlan, CreatePr, UpdatePlan, SplitPlan, ExpandPlan y CreateIssue.
- **Compatibilidad multiplataforma**: macOS y Windows con detección automática de plataforma.
- **Ejecución basada en worktrees**: Los planes se ejecutan en git worktrees aislados para mantener limpio el repositorio principal.
- **Verificaciones configurables**: Build, Test, Format, Lint y CheckResult (con variantes específicas como DotnetBuild, NpmTest).
- **Integración con GitHub**: Creación automática de PR, seguimiento de estados y detección de fusiones.
- **Atajos de teclado**: `Ctrl+Alt+D` para nuevos borradores, con atajos personalizables.
