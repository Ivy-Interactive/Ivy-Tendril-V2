---
title: Instalação
description: Instale o Tendril por meio de binários pré-compilados ou compile a
  partir do código-fonte, execute o aplicativo desktop e a CLI e configure seu
  ambiente.
icon: Download
searchHints:
  - instalar
  - binários pré-compilados
  - compilar a partir do código-fonte
  - pré-requisitos
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - atualizar
---

# Instalação

O Tendril pode ser instalado por meio de pacotes de desktop pré-compilados e binários de CLI, ou compilado localmente a partir do código-fonte.

## Instalação rápida

Baixe instaladores de desktop independentes (`.dmg`, `.pkg`, `.exe`, `.AppImage`, `.deb`) diretamente dos
[GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) ou execute um dos
scripts de instalação automatizados:

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

O instalador coloca o binário da CLI `tendril` no seu `PATH` e registra o aplicativo desktop no menu do seu
sistema.

## Pré-requisitos (para compilar a partir do código-fonte)

Se for compilar a partir do código-fonte, certifique-se de que estas dependências estejam instaladas e disponíveis no seu `PATH`:

| Ferramenta                                   | Versão              | Função                                                                                   |
| -------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (edição 2021) | Compila a CLI nativa, o daemon do servidor e o core.                                     |
| [Node.js](https://nodejs.org/)               | 22 ou mais recente  | Alimenta o ferramental de front-end e os scripts de build.                               |
| [pnpm](https://pnpm.io/)                     | 11 ou mais recente  | Gerencia pacotes e dependências do workspace.                                            |
| [Vite+](https://viteplus.dev/) (`vp`)        | atual               | Orquestra build, linting, formatação e testes.                                           |
| [Git](https://git-scm.com/)                  | 2.30+               | Gerencia [git worktrees](https://git-scm.com/docs/git-worktree), commits e ramificações. |
| [GitHub CLI](https://cli.github.com/) (`gh`) | autenticado         | Abre pull requests e gerencia issues automaticamente.                                    |

Você também precisará de pelo menos uma CLI de agente de programação autenticada (por exemplo, [Claude Code](https://code.claude.com/docs),
[GitHub Copilot](https://github.com/features/copilot), [Gemini](https://ai.google.dev),
[OpenCode](https://opencode.ai), [Antigravity](https://github.com/google-deepmind) ou
[Cursor](https://www.cursor.com)). O guia de [Integração de uma Base de Código](03_Onboarding.md) aborda a configuração de agentes em detalhes.

## Compilar a partir do código-fonte

Clone o repositório e instale as dependências do workspace:

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # shared UI library, required by the desktop app
node src/scripts/ensure-wireframe-payload.mjs      # prepares wireframe assets for native build
cargo build --workspace                            # builds tendril-core, tendril-server, tendril-cli
```

> [!NOTE]
> A biblioteca `@ivy-interactive/components` e a carga útil de wireframes devem ser geradas antes de compilar os
> crates nativos do workspace, já que o `tendril-app` e o `tendril-wireframe` importam esses assets em tempo de compilação.

## Executar o aplicativo desktop

Para desenvolvimento local com hot module reloading:

```bash
pnpm dev:desktop
```

Este comando compila os binários de sidecar necessários e inicializa o Vite juntamente com a janela nativa do
[Tauri 2](https://tauri.app). O aplicativo desktop gerencia o daemon em segundo plano (`tendril run`)
automaticamente.

### Empacotando uma versão independente

Para empacotar um bundle de versão independente para a sua plataforma:

```bash
cargo build --release --bin tendril

# Stage the native CLI sidecar for your target architecture
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# Fetch the bundled OpenCode sidecar agent
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# Build the installer package (DMG on macOS, NSIS/MSI on Windows, AppImage/deb on Linux)
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## Instalar a CLI

O binário `tendril` serve tanto como a interface de linha de comando quanto como o servidor daemon:

```bash
cargo build --release --bin tendril
# or install directly to ~/.cargo/bin:
cargo install --path src/crates/tendril-cli
```

Verifique sua instalação com o utilitário de verificação de integridade:

```bash
tendril version
tendril doctor
```

O comando `tendril doctor` verifica a variável `$TENDRIL_HOME`, a sintaxe do `config.yaml`, o banco de dados [SQLite](https://www.sqlite.org),
o diretório de planos e suas credenciais do `git` e do `gh`.

### Executando o daemon em modo headless

Para executar o Tendril como um servidor daemon em modo headless, sem a interface gráfica de desktop:

```bash
# Recommended: checks port availability and executes pending database migrations
tendril run

# Or run the direct listener (supports --tls-cert and --tls-key)
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> O servidor escuta em `127.0.0.1:5010` por padrão, expondo endpoints REST e WebSocket. Ele não
> serve uma interface web estática; interaja com ele por meio do aplicativo desktop ou da CLI.

## Configuração e estrutura de diretórios

Todo o estado de tempo de execução do Tendril é armazenado dentro de `$TENDRIL_HOME`, resolvido na seguinte ordem de precedência:

1. A variável de ambiente `TENDRIL_HOME`;
2. O caminho gravado em `~/.tendril_location` (se presente);
3. O local padrão do usuário: `~/.tendril`.

Dentro de `$TENDRIL_HOME`:

```
~/.tendril/
├── config.yaml     # coding agent, project definitions, verifications, promptware overrides
├── tendril.db      # SQLite database for jobs, costs, and execution telemetry
├── Plans/          # structured plans and their isolated git worktrees
├── Jobs/           # execution logs, agent prompts, and raw transcript recordings
└── Promptwares/    # deployed workflow agent definitions
```

Um `config.yaml` mínimo:

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

Faça o deploy dos promptwares padrão para inicializar as definições de agentes:

```bash
tendril promptware deploy
```

> [!WARNING]
> Certifique-se de que a CLI do seu agente de programação escolhido esteja autenticada antes de iniciar seu primeiro job. Se um agente pausar
> para solicitar credenciais em um processo em segundo plano não assistido, o job será bloqueado ou atingirá o tempo limite.

## Atualização

Se tiver instalado por meio do script de instalação, execute novamente o comando de linha única para obter a versão mais recente.

Se estiver trabalhando a partir de uma cópia clonada do código-fonte:

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## Próximos passos

- [Integração de uma Base de Código](03_Onboarding.md) — configure os pré-requisitos do repositório e verifique o acesso do agente.
- [Conceitos: Planos](../02_Concepts/01_Plans.md) — entenda as estruturas de planos e os ciclos de vida de revisão.
- [Solução de Problemas](06_Troubleshooting.md) — soluções para erros de compilação e de tempo de execução.
