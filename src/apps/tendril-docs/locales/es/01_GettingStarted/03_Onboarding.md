---
title: Incorporación de una base de código
description: >-
  Una lista de comprobación para preparar tu equipo de desarrollo y tu repositorio, de modo que Tendril pueda planificar, ejecutar, verificar
  y enviar cambios de forma desatendida.
icon: ClipboardCheck
searchHints:
  - incorporación
  - lista de comprobación
  - preparar
  - equipo de desarrollo
  - entorno
  - worktree
  - AGENTS.md
  - gh
  - mcp
---

# Incorporación de una base de código

Tendril ejecuta un agente de programación sobre tu repositorio dentro de un
[Git worktree](https://git-scm.com/docs/git-worktree) aislado, luego compila, prueba y abre un pull request.
Para que este ciclo tenga éxito sin intervención humana, el equipo y el repositorio deben estar configurados
previamente. Revisa la siguiente lista de comprobación una vez por máquina y una vez por base de código.

> [!TIP]
> Cuando hayas terminado, ejecuta `tendril doctor`. Esto confirma el directorio de Tendril, `config.yaml`, la base de datos,
> el directorio de planes, `git` y `gh`. **No** comprueba tu agente de programación; verifícalo tú mismo
> con el paso 2 que se describe a continuación.

## Lista de comprobación del equipo

### 1. El software de compilación necesario está instalado

Cada herramienta necesaria para compilar el proyecto debe estar instalada y disponible en tu `PATH`. El agente no puede
instalar un compilador o un SDK que falte a mitad de la ejecución. Para un repositorio de Rust y pnpm como el propio Tendril, eso implica
[Rustup](https://rustup.rs/), [Node.js](https://nodejs.org/) y [pnpm](https://pnpm.io/); para tu
proyecto significa cualquier cadena de herramientas de compilación que invoquen tus scripts.

> [!NOTE]
> El requisito objetivo: un clon limpio debe compilarse desde una terminal limpia mediante los comandos documentados, sin
> mensajes interactivos y sin pasos manuales exclusivos del IDE.

### 2. La CLI de programación preferida está instalada y autenticada

Instala el agente definido como `codingAgent` en `config.yaml` e inicia sesión para que se ejecute de forma no interactiva:

```bash
# Ejemplo: Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

Verifica que la CLI esté en tu `PATH` y que una invocación simple no se detenga solicitando credenciales:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor` / `cursor-agent`)
- Apple Foundation Models (`apple` mediante `fm` en el dispositivo)

El agente `apple` es la excepción: se ejecuta a través del OpenCode integrado contra el modelo en el dispositivo de Apple,
por lo que debes asegurarte de que `fm` esté instalado (compruébalo con `fm available`) y de que un proceso `fm serve` ya esté escuchando.

### 3. Git está instalado y autorizado para uso desatendido

Tendril descarga código, crea worktrees, realiza commits y hace push en tu nombre. Confirma que todas las operaciones funcionen
sin solicitudes interactivas:

- Hay una identidad global configurada (`git config --global user.name` y `user.email`).
- Las credenciales se almacenan en caché mediante un helper de credenciales o una clave SSH cargada en un agente, de forma que `git pull` y
  `git push` nunca soliciten contraseñas.
- Los worktrees se pueden añadir y eliminar (`git worktree add` y `git worktree remove`).

> [!WARNING]
> Si hacer push mediante HTTPS solicita credenciales, configura un helper de credenciales o utiliza una clave SSH con un
> `ssh-agent` activo. Una sola solicitud interactiva detendrá un trabajo que de otro modo sería desatendido.

### 4. La CLI de GitHub está instalada y autenticada

[CreatePr](../02_Concepts/02_Promptwares.md) utiliza la [CLI de GitHub](https://cli.github.com/)
(`gh`) para abrir pull requests. Instálala y verifica la autenticación:

```bash
gh auth login
gh auth status
```

### 5. Los servidores MCP necesarios están instalados globalmente

Si utilizas servidores de [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) — como Jira
para el contexto de incidencias o Figma para diseños de interfaz —, instálalos y regístralos globalmente para que cada worktree pueda acceder
a ellos. Los servidores MCP se registran en el agente de programación, no dentro de Tendril:

```bash
# Ejemplo: registrar un servidor MCP globalmente para Claude Code
claude mcp add --scope user jira -- npx -y @your-org/jira-mcp
claude mcp add --scope user figma -- npx -y figma-developer-mcp
claude mcp list   # verificar que sean accesibles
```

> [!NOTE]
> Utiliza el ámbito global o de usuario, no el de proyecto, para que los servidores MCP persistan en los worktrees de git efímeros en los que
> trabaja el agente. Almacena cualquier token de API requerido como variables de entorno en tu sistema.

Asegúrate de estar realmente _autenticado_ en cada servidor MCP, no solo de que esté registrado. Ejecuta un
pequeño plan de prueba desde Tendril y confirma que cada servidor se inicialice sin abrir ventanas modales de OAuth.

## Lista de comprobación del repositorio

### 6. El repositorio está preparado para worktrees

[ExecutePlan](../02_Concepts/02_Promptwares.md) se ejecuta dentro de un
[Git worktree](https://git-scm.com/docs/git-worktree) aislado, no en tu directorio de trabajo activo. Un worktree parte
de un commit limpio: no existen directorios `target/`, `node_modules/` ni archivos `.env` sin seguimiento.

- Documenta cualquier comando de configuración necesario tras el checkout antes de compilar el código (por ejemplo, restauración de dependencias,
  generación de código, copias de `.env` de ejemplo), y proporciona un script de configuración confirmado en git.
- No dependas de archivos no confirmados que solo existan en tu checkout principal.
- Emplea un gestor de paquetes con caché centralizada para que cada worktree se restaure en segundos en lugar de
  volver a descargar paquetes (por ejemplo, el store de pnpm, la caché del registro de Cargo o la caché de módulos de Go).

> [!TIP]
> Prueba rápida: ejecuta `git worktree add ../repo-probe`, y luego lanza los comandos de compilación documentados en ese
> directorio desde una terminal limpia. Si compila y pasa las pruebas, Tendril también tendrá éxito. Elimínalo con
> `git worktree remove ../repo-probe`.

### 7. Escribe un script de ejecución para cada aplicación

Proporciona un script de inicio pequeño y confirmado en el repositorio para cada aplicación con puertos configurables.
Tendril puede ejecutar planes paralelos en varios worktrees a la vez, por lo que los puertos codificados en rígido provocan colisiones.

Para un frontend con [Vite](https://vite.dev) emparejado con una API en Python, el script podría ser:

```bash
#!/usr/bin/env bash
# run.sh - lanza la API backend de Python y el frontend de Vite
set -euo pipefail

api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"

cd "$(dirname "$0")"

# Backend: configurar entorno virtual e instalar dependencias
python -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# Iniciar la API backend en su puerto dedicado
uvicorn app.main:app --port "$api_port" &
api_pid=$!

# Detener el backend cuando el proceso del frontend termine
trap 'kill "$api_pid" 2>/dev/null' EXIT

# Frontend: instalar dependencias e iniciar el servidor de desarrollo de Vite
npm --prefix web install --prefer-offline --no-audit
npm --prefix web run dev -- --port "$web_port" --open
```

> [!NOTE]
> Mantener los comandos de inicio en un script en el repositorio garantiza que tanto los desarrolladores como los agentes de flujo
> de trabajo autónomos inicien la aplicación de manera idéntica.

### 8. Añade un AGENTS.md (o README.md) en la raíz del repositorio

Proporciona a los agentes de flujo de trabajo el contexto fundamental que necesitan para explorar la base de código sin suposiciones:

- **Requisitos previos** necesarios para compilar y ejecutar el código.
- **Mapa arquitectónico** que detalle aplicaciones, bibliotecas y protocolos de comunicación.
- **Comandos de compilación y prueba** que compilan y verifican el repositorio.
- **Scripts de ejecución** que apunten a los scripts de inicio del paso anterior.

## Próximos pasos

- Sigue el ciclo de principio a fin en el [Tutorial](04_Tutorial.md).
- Explora los [Conceptos: Planes](../02_Concepts/01_Plans.md) y [Promptwares](../02_Concepts/02_Promptwares.md).
- Comprende el [Ciclo de vida de los trabajos](../02_Concepts/03_Lifecycle.md).
