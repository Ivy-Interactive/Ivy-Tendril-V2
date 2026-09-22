---
title: Integrando uma Base de Código
description: Um checklist para preparar sua máquina de desenvolvimento e seu
  repositório para que o Tendril possa planejar, executar, verificar e enviar
  alterações de forma autônoma.
icon: ClipboardCheck
searchHints:
  - onboarding
  - checklist
  - preparar
  - máquina de desenvolvimento
  - ambiente
  - worktree
  - AGENTS.md
  - gh
  - mcp
---

# Integrando uma Base de Código

O Tendril executa um agente de codificação em seu repositório dentro de uma
[Git worktree](https://git-scm.com/docs/git-worktree) isolada, depois compila, testa e abre um pull request.
Para que esse ciclo tenha sucesso sem intervenção humana, a máquina e o repositório precisam estar configurados
com antecedência. Siga o checklist abaixo uma vez por máquina e uma vez por base de código.

> [!TIP]
> Quando terminar, execute `tendril doctor`. Ele verifica o diretório home do Tendril, o `config.yaml`, o banco de dados, o
> diretório de planos, o `git` e o `gh`. Ele **não** testa seu agente de codificação — verifique isso você mesmo com
> o passo 2 abaixo.

## Checklist da máquina

### 1. O software de build necessário está instalado

Todas as ferramentas necessárias para compilar o projeto devem estar instaladas e disponíveis no seu `PATH`. O agente não pode
instalar um compilador ou SDK ausente no meio da execução. Para um repositório em Rust e pnpm como o do próprio Tendril, isso significa
[Rustup](https://rustup.rs/), [Node.js](https://nodejs.org/) e [pnpm](https://pnpm.io/); para o seu
projeto, significa qualquer toolchain de build que seus scripts invoquem.

> [!NOTE]
> O requisito principal: um clone novo compila a partir de um terminal limpo usando comandos documentados, sem
> prompts interativos e sem etapas manuais exclusivas de IDE.

### 2. A CLI de codificação preferida está instalada e autenticada

Instale o agente configurado como `codingAgent` no `config.yaml` e faça login para que ele execute de forma não interativa:

```bash
# Example: Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

Verifique se a CLI está no `PATH` e se uma invocação simples não para para solicitar credenciais:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor` / `cursor-agent`)
- Apple Foundation Models (`apple` via `fm` no dispositivo)

O agente `apple` é a exceção: ele é executado por meio do OpenCode integrado contra o modelo local da Apple no dispositivo,
portanto garanta que `fm` esteja instalado (verifique com `fm available`) e que um processo `fm serve` já esteja em execução escutando requisições.

### 3. O Git está instalado e autorizado para uso autônomo

O Tendril faz pull de código, cria worktrees, faz commits e envia pushes em seu nome. Confirme se todas as operações funcionam
sem um prompt interativo:

- Uma identidade global está configurada (`git config --global user.name` e `user.email`).
- As credenciais estão em cache por meio de um auxiliar de credenciais ou uma chave SSH carregada em um agente, para que `git pull` e
  `git push` nunca peçam senhas.
- Worktrees podem ser adicionadas e removidas (`git worktree add` e `git worktree remove`).

> [!WARNING]
> Se o envio via HTTPS solicitar credenciais, configure um auxiliar de credenciais ou use uma chave SSH com um
> `ssh-agent` ativo. Um único prompt interativo interromperá uma tarefa que deveria ser executada sem supervisão.

### 4. A GitHub CLI está instalada e autenticada

[CreatePr](../02_Concepts/02_Promptwares.md) usa a [GitHub CLI](https://cli.github.com/)
(`gh`) para abrir pull requests. Instale-a e verifique a autenticação:

```bash
gh auth login
gh auth status
```

### 5. Os servidores MCP necessários estão instalados globalmente

Se você depende de servidores do [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) — como Jira
para contexto de issues ou Figma para designs de UI — instale-os e registre-os globalmente para que cada worktree possa acessá-los.
Os servidores MCP são registrados no agente de codificação, não dentro do Tendril:

```bash
# Example: register an MCP server globally for Claude Code
claude mcp add --scope user jira -- npx -y @your-org/jira-mcp
claude mcp add --scope user figma -- npx -y figma-developer-mcp
claude mcp list   # verify they are reachable
```

> [!NOTE]
> Use o escopo global ou de usuário, não o escopo do projeto, para que os servidores MCP continuem disponíveis após a criação das git worktrees efêmeras
> em que o agente trabalha. Armazene todos os tokens de API necessários como variáveis de ambiente em seu sistema.

Certifique-se de que você está de fato _autenticado_ em cada servidor MCP, e não apenas de que ele está registrado. Execute um
pequeno plano de teste a partir do Tendril e confirme se todos os servidores inicializam sem abrir modais de OAuth.

## Checklist do repositório

### 6. O repositório está pronto para worktree

[ExecutePlan](../02_Concepts/02_Promptwares.md) roda dentro de uma
[Git worktree](https://git-scm.com/docs/git-worktree) isolada, não no seu diretório de trabalho ativo. Uma worktree começa
a partir de um commit limpo — nenhum `target/`, `node_modules/` ou arquivos `.env` não rastreados existem.

- Documente todos os comandos de configuração necessários após o checkout antes que o código possa ser compilado (por exemplo, restauração de dependências,
  geração de código, cópias de `.env` de exemplo) e forneça um script de setup versionado.
- Não dependa de arquivos não versionados que existem apenas no seu checkout principal.
- Use um gerenciador de pacotes com cache centralizado para que cada worktree seja restaurada em segundos em vez de
  baixar os pacotes novamente (por exemplo, a store do pnpm, o cache de registro do Cargo ou o cache de módulos do Go).

> [!TIP]
> Teste rápido: execute `git worktree add ../repo-probe`, depois execute seus comandos documentados de build nesse
> diretório a partir de um terminal limpo. Se compilar e passar nos testes, o Tendril também terá sucesso. Remova-o com
> `git worktree remove ../repo-probe`.

### 7. Escreva um script de execução para cada aplicação

Forneça um script de inicialização pequeno e versionado para cada aplicação no repositório com portas configuráveis.
O Tendril pode executar planos paralelos em várias worktrees simultaneamente, portanto portas fixas no código causam colisões de portas.

Para um frontend [Vite](https://vite.dev) pareado com uma API em Python, o script pode ser semelhante a:

```bash
#!/usr/bin/env bash
# run.sh - launch the Python backend API and the Vite frontend
set -euo pipefail

api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"

cd "$(dirname "$0")"

# Backend: configure virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# Start backend API on its dedicated port
uvicorn app.main:app --port "$api_port" &
api_pid=$!

# Terminate backend when the frontend process exits
trap 'kill "$api_pid" 2>/dev/null' EXIT

# Frontend: install dependencies and start Vite dev server
npm --prefix web install --prefer-offline --no-audit
npm --prefix web run dev -- --port "$web_port" --open
```

> [!NOTE]
> Manter os comandos de inicialização em um script versionado garante que tanto desenvolvedores quanto agentes autônomos de fluxo de trabalho
> iniciem a aplicação de forma idêntica.

### 8. Adicione um AGENTS.md (ou README.md) na raiz do repositório

Dê aos agentes de fluxo de trabalho o contexto fundamental de que precisam para navegar pela base de código sem adivinhações:

- **Pré-requisitos** necessários para compilar e executar o código.
- **Mapa arquitetural** detalhando aplicações, bibliotecas e protocolos de comunicação.
- **Comandos de build e teste** que compilam e verificam o repositório.
- **Scripts de execução** apontando para os scripts de inicialização do passo anterior.

## Próximos passos

- Acompanhe o fluxo de ponta a ponta no [Tutorial](04_Tutorial.md).
- Explore [Conceitos: Planos](../02_Concepts/01_Plans.md) e [Promptwares](../02_Concepts/02_Promptwares.md).
- Entenda o [Ciclo de Vida do Job](../02_Concepts/03_Lifecycle.md).
