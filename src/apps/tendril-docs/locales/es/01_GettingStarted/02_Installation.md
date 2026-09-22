---
title: Instalación
description: Instala Tendril mediante binarios precompilados o compila desde el código fuente, ejecuta la aplicación de escritorio y la CLI, y configura tu entorno.
icon: Download
searchHints:
  - instalar
  - binarios precompilados
  - compilar desde código fuente
  - requisitos previos
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - actualizar
---

# Instalación

Tendril se puede instalar mediante paquetes de escritorio precompilados y binarios de CLI, o compilarse localmente desde el código fuente.

## Instalación rápida

Descarga instaladores de escritorio independientes (`.dmg`, `.pkg`, `.exe`, `.AppImage`, `.deb`) directamente desde
[GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) o ejecuta uno de los
scripts de instalación automatizados:

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

El instalador coloca el binario de la CLI `tendril` en tu `PATH` y registra la aplicación de escritorio en el menú
de tu sistema.

## Requisitos previos (para compilar desde el código fuente)

Si compilas desde el código fuente, asegúrate de que estas dependencias estén instaladas y disponibles en tu `PATH`:

| Herramienta                                  | Versión              | Rol                                                                                        |
| -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (edición 2021) | Compila la CLI nativa, el daemon del servidor y el núcleo (core).                          |
| [Node.js](https://nodejs.org/)               | 22 o superior        | Impulsa las herramientas de front-end y los scripts de compilación.                        |
| [pnpm](https://pnpm.io/)                     | 11 o superior        | Gestiona los paquetes del workspace y las dependencias.                                    |
| [Vite+](https://viteplus.dev/) (`vp`)        | actual               | Orquesta compilación, análisis estático (linting), formateo y pruebas.                     |
| [Git](https://git-scm.com/)                  | 2.30+                | Gestiona [git worktrees](https://git-scm.com/docs/git-worktree), commits y ramificaciones. |
| [GitHub CLI](https://cli.github.com/) (`gh`) | autenticado          | Abre pull requests y gestiona incidencias (issues) automáticamente.                        |

También necesitarás al menos una CLI de agente de programación autenticada (por ejemplo, [Claude Code](https://code.claude.com/docs),
[GitHub Copilot](https://github.com/features/copilot), [Gemini](https://ai.google.dev),
[OpenCode](https://opencode.ai), [Antigravity](https://github.com/google-deepmind) o
[Cursor](https://www.cursor.com)). [Incorporación de una base de código](03_Onboarding.md) cubre la configuración de los agentes en detalle.

## Compilar desde el código fuente

Clona el repositorio e instala las dependencias del workspace:

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # biblioteca de interfaz compartida, requerida por la app de escritorio
node src/scripts/ensure-wireframe-payload.mjs      # prepara los recursos de wireframe para la compilación nativa
cargo build --workspace                            # compila tendril-core, tendril-server, tendril-cli
```

> [!NOTE]
> La biblioteca `@ivy-interactive/components` y el payload de wireframe deben generarse antes de compilar
> los crates nativos del workspace, ya que `tendril-app` y `tendril-wireframe` importan estos recursos durante la compilación.

## Ejecutar la aplicación de escritorio

Para el desarrollo local con recarga rápida de módulos (hot module reloading):

```bash
pnpm dev:desktop
```

Este comando compila los binarios sidecar necesarios y ejecuta Vite junto a la ventana nativa de
[Tauri 2](https://tauri.app). La aplicación de escritorio gestiona el daemon en segundo plano (`tendril run`)
automáticamente.

### Empaquetar una versión independiente (standalone)

Para empaquetar un instalador independiente para tu plataforma:

```bash
cargo build --release --bin tendril

# Prepara el sidecar de la CLI nativa para tu arquitectura de destino
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# Descarga el agente sidecar OpenCode incluido
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# Construye el paquete instalador (DMG en macOS, NSIS/MSI en Windows, AppImage/deb en Linux)
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## Instalar la CLI

El binario `tendril` sirve tanto de interfaz de línea de comandos como de servidor daemon:

```bash
cargo build --release --bin tendril
# o instálalo directamente en ~/.cargo/bin:
cargo install --path src/crates/tendril-cli
```

Verifica tu instalación mediante el comprobador de salud (doctor):

```bash
tendril version
tendril doctor
```

`tendril doctor` comprueba `$TENDRIL_HOME`, la sintaxis de `config.yaml`, la base de datos [SQLite](https://www.sqlite.org),
el directorio de planes y tus credenciales de `git` y `gh`.

### Ejecutar el daemon sin interfaz (headless)

Para ejecutar Tendril como daemon de servidor sin la interfaz gráfica de escritorio:

```bash
# Recomendado: comprueba la disponibilidad del puerto y aplica migraciones de base de datos pendientes
tendril run

# O ejecuta el listener directo (admite --tls-cert y --tls-key)
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> El servidor escucha por defecto en `127.0.0.1:5010`, exponiendo endpoints REST y WebSocket. No aloja
> una interfaz web estática; interactúa con él a través de la aplicación de escritorio o la CLI.

## Configuración y estructura de directorios

Todo el estado en tiempo de ejecución de Tendril se almacena en `$TENDRIL_HOME`, determinado según la siguiente prioridad:

1. La variable de entorno `TENDRIL_HOME`;
2. La ruta registrada en `~/.tendril_location` (si existe);
3. La ubicación de usuario predeterminada: `~/.tendril`.

Dentro de `$TENDRIL_HOME`:

```
~/.tendril/
├── config.yaml     # agente de programación, proyectos, verificaciones, personalización de promptwares
├── tendril.db      # base de datos SQLite para trabajos, costes y telemetría de ejecución
├── Plans/          # planes estructurados y sus git worktrees aislados
├── Jobs/           # registros de ejecución, prompts del agente y grabaciones de transcripciones
└── Promptwares/    # definiciones desplegadas de agentes de flujo de trabajo
```

Un archivo `config.yaml` mínimo:

```yaml
codingAgent: claude
maxConcurrentJobs: 20

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

Despliega los promptwares estándar para inicializar las definiciones de agentes:

```bash
tendril promptware deploy
```

> [!WARNING]
> Asegúrate de que la CLI del agente de programación elegido esté autenticada antes de iniciar tu primer trabajo. Si un agente se detiene
> para solicitar credenciales en un proceso en segundo plano desatendido, el trabajo se bloqueará o superará el tiempo de espera.

## Actualización

Si instalaste Tendril con el script de instalación, vuelve a ejecutar el comando de una sola línea para obtener la última versión.

Si trabajas desde un clon del código fuente:

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## Próximos pasos

- [Incorporación de una base de código](03_Onboarding.md) — configura los requisitos del repositorio y verifica el acceso de los agentes.
- [Conceptos: Planes](../02_Concepts/01_Plans.md) — comprende las estructuras de planes y los ciclos de vida de revisión.
- [Solución de problemas](06_Troubleshooting.md) — soluciones a errores de compilación y tiempo de ejecución.
