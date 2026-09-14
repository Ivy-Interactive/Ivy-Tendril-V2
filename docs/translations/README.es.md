<p align="right">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <strong>Español</strong> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a>
</p>

<h1>
  <a href="https://tendril.ivy.app"><img src="../../src/logo.png" alt="Tendril Logo" width="64" valign="middle" /></a> Ivy Tendril
</h1>

<p>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/stargazers"><img src="https://img.shields.io/github/stars/Ivy-Interactive/Ivy-Tendril?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest"><img src="https://img.shields.io/github/v/release/Ivy-Interactive/Ivy-Tendril?style=flat&label=release" alt="Latest Release" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/actions/workflows/repo-health.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivy-Interactive/Ivy-Tendril/repo-health.yml?branch=development&style=flat&label=CI" alt="CI Status" /></a>
  <a href="https://tendril.ivy.app"><img src="https://img.shields.io/badge/docs-tendril.ivy.app-blue?style=flat" alt="Documentación" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Plataformas compatibles: macOS, Windows y Linux" />
</p>

<h2>La factoría de software agéntico para desarrolladores 10x</h2>

<p>
Los agentes de IA ahora pueden escribir el 99% del código. Esto cambia lo que significa ser un desarrollador. Nuestro rol pasa a ser saber <strong>cómo se ve el código de calidad</strong>. Para lograrlo, necesitamos herramientas de desarrollo completamente nuevas. Tendril es esa herramienta y sustituye a tu IDE en la era agéntica.
</p>

<p>
<a href="https://youtu.be/_KVG1NnAj-8">
  <img src="../yt-thumbnail-in-two-minutes-2.png" alt="Ivy Tendril en dos minutos: ver en YouTube" width="720">
</a>
</p>

<p>https://youtu.be/_KVG1NnAj-8</p>

## Características

<table>
<tr>
<td width="50%" valign="middle">

### Árboles de trabajo paralelos (Parallel Worktrees)

Ejecuta agentes en árboles de trabajo aislados de git. Mantén limpia tu rama principal hasta revisar, aprobar y fusionar los cambios.

[Documentación &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/worktrees.gif" alt="Árboles de trabajo paralelos" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Túneles (Tunneling) (Programación remota y móvil)

Expón tu servidor de forma segura usando Cloudflare Quick Tunnels para monitorizar y dirigir ejecuciones de agentes desde cualquier lugar.

[Documentación &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/tunneling.gif" alt="Túneles" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Voz y entrada enriquecida (Voice & Rich Input)

Dicta prompts usando la entrada de voz integrada de Whisper y adjunta archivos de texto, registros o documentos arrastrando y soltando.

[Documentación &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/voice.gif" alt="Voz y entrada enriquecida" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Anotaciones en planes (Plan Annotations)

Anota borradores en línea para actualizar automáticamente los planes con objetivos revisados para el agente.

[Documentación &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/annotation.gif" alt="Anotaciones en planes" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Revisiones de código potentes (Code Reviews)

Revisa los cambios del agente, inspecciona diferencias y aprueba código con puertas de verificación automatizadas.

[Documentación &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/review.gif" alt="Revisiones de código potentes" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Integración con GitHub y bandeja de entrada automatizada (GitHub Integration & Automated Inbox)

Ingiere issues de GitHub o reportes de errores de jam.dev mediante webhooks para convertir planes Markdown en tareas activas automáticamente.

[Documentación &rarr;](https://tendril.ivy.app/docs/integrations/jamdev)

</td>
<td width="50%">
  <img src="../../src/github.gif" alt="Integración con GitHub y bandeja de entrada automatizada" width="100%" />
</td>
</tr>
</table>

---

## Agentes compatibles

Funciona con **cualquier agente CLI**: si se ejecuta en una terminal, se ejecuta en Tendril.

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Claude Code logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Codex logo" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="GitHub Copilot logo" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://gemini.google.com/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Gemini logo" width="16" valign="middle" /> Gemini</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="OpenCode logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <kbd>+ cualquier agente CLI</kbd>
</p>

## Habilidades de agentes (Agent Skills)

Extiende tus agentes de codificación IA favoritos con habilidades oficiales de ingeniería y depuración de Tendril.

### Inicio rápido

Instala habilidades de Tendril para cualquier agente compatible usando el instalador universal:

```bash
npx skills add ivy-interactive/ivy-tendril
```

O instala una habilidad específica:

```bash
npx skills add ivy-interactive/ivy-tendril --skill tendril-debug-plan
```

### Herramientas y entornos compatibles

<details>
<summary><strong>Visual Studio Code (GitHub Copilot y extensiones)</strong></summary>

Instala habilidades para GitHub Copilot en VS Code:

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot
```

Instalación global (en todos los espacios de trabajo):

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot -g
```

O copia las habilidades directamente en `.agents/skills/` o `.github/skills/` (a nivel de proyecto) o en `~/.copilot/skills/` (global).

Una vez instaladas, las habilidades aparecen en GitHub Copilot Chat bajo el menú `/skills` y se pueden invocar directamente como comandos de barra (por ejemplo, `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`).

Extensiones de agentes de terceros para VS Code:
- Cline: `npx skills add ivy-interactive/ivy-tendril --agent cline`
- Continue: `npx skills add ivy-interactive/ivy-tendril --agent continue`
- Roo Code: `npx skills add ivy-interactive/ivy-tendril --agent roo`

Para una integración completa en el editor, instala la [extensión oficial de Ivy Tendril para VS Code](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) para paneles de planes integrados, navegación por árboles de trabajo y monitoreo de ejecución en vivo.

Consulta la [Guía de configuración de VS Code](../vscode-setup.md) para opciones de configuración detalladas.
</details>

<details>
<summary><strong>Claude Code</strong></summary>

Instala desde el marketplace de plugins de Claude Code:

```
/plugin marketplace add ivy-interactive/ivy-tendril
/plugin install tendril-skills@ivy-tendril
```

Desarrollo local:

```bash
claude --plugin-dir /path/to/ivy-tendril
```

Consulta la [Guía de configuración de Claude Code](../claude-setup.md) para opciones detalladas.
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

Instala el plugin mediante URL de Git:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril.git
```

Instalación local:

```bash
agy plugin install ./
```

Consulta la [Guía de configuración de Antigravity](../antigravity-setup.md) para opciones detalladas.
</details>

<details>
<summary><strong>Cursor</strong></summary>

Instalación para Cursor:

```bash
npx skills add ivy-interactive/ivy-tendril --agent cursor
```

O copia las habilidades en `.cursor/skills/` (a nivel de proyecto) o en `~/.cursor/skills/` (global).

Consulta la [Guía de configuración de Cursor](../cursor-setup.md) para opciones detalladas.
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Instala desde el marketplace de plugins de Codex:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril
codex plugin add tendril-skills@tendril-skills
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Instala usando la CLI de Gemini:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril.git --path skills
```
</details>

---

## Instalación

Descarga los instaladores de escritorio independientes (`.pkg`, `.AppImage`, `.exe`) directamente desde [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) o ejecuta uno de los siguientes comandos de instalación rápida:

**macOS / Linux:**
```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows:**
```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

### Ejecución

Tendril es una aplicación de escritorio, pero también se puede iniciar y controlar mediante la CLI:

Iniciar la aplicación de escritorio:
```bash
tendril
```

Iniciar en modo headless (servidor web sin interfaz gráfica):
```bash
tendril --web
```

---

## 🏛 Estructura del directorio

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   └── tendril-app/            # Aplicación de escritorio Tauri + frontend React
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # Modelos de dominio principales, base de datos SQLite, motor de worktrees
│   │   ├── tendril-server/         # Servidor demonio HTTP Axum REST y WebSocket
│   │   └── tendril-cli/            # Interfaz de línea de comandos ("tendril")
│   └── promptwares/                # Definiciones de agentes Promptware y firmware
├── Cargo.toml                      # Espacio de trabajo Cargo unificado
├── pnpm-workspace.yaml             # Espacio de trabajo pnpm unificado
└── package.json                    # Scripts raíz del espacio de trabajo
```

---

## 🚀 Primeros pasos

### Requisitos previos
- [Rust](https://rustup.rs/) (edición 2021)
- [Node.js](https://nodejs.org/) (v22+) y [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### Inicio rápido

1. **Instalar dependencias**:
   ```bash
   pnpm install
   ```

2. **Compilar componentes y biblioteca de UI**:
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **Iniciar Storybook**:
   ```bash
   pnpm dev:storybook
   ```

4. **Compilar y ejecutar la aplicación de escritorio**:
   ```bash
   pnpm dev:app
   ```

5. **Compilar crates del backend**:
   ```bash
   cargo build --workspace
   ```

6. **Ejecutar pruebas**:
   ```bash
   # Pruebas web y de componentes
   pnpm test

   # Pruebas de Rust
   cargo test --workspace
   ```

---

## Comunidad y soporte

- **Discord:** Únete a la comunidad en **[Discord](https://discord.gg/FHgxkDga3y)**.
- **Comentarios e ideas:** ¿Encontraste un error o tienes una idea? [Abre un issue](https://github.com/Ivy-Interactive/Ivy-Tendril/issues).
- **Apóyanos:** Dale una [estrella (Star)](https://github.com/Ivy-Interactive/Ivy-Tendril) a este repositorio para seguir nuestro desarrollo.

---

## Licencia

Tendril está disponible bajo la licencia [Functional Source License (FSL-1.1-ALv2)](LICENSE). Las habilidades y complementos del agente (`skills/`, `.claude-plugin/`, `.codex-plugin/`, `.agents/`) también están licenciados bajo los términos de la raíz del repositorio ([Functional Source License (FSL-1.1-ALv2)](LICENSE)).
