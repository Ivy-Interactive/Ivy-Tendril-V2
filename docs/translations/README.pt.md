<p align="right">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.sv.md">Svenska</a> | <strong>Português (Brasil)</strong>
</p>

<h1>
  <a href="https://tendril.ivy.app"><img src="../../src/logo.png" alt="Logo do Tendril" width="64" valign="middle" /></a> Ivy Tendril
</h1>

<p>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/stargazers"><img src="https://img.shields.io/github/stars/Ivy-Interactive/Ivy-Tendril?style=flat&label=%E2%98%85" alt="Estrelas no GitHub" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest"><img src="https://img.shields.io/github/v/release/Ivy-Interactive/Ivy-Tendril?style=flat&label=release" alt="Último Lançamento" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/actions/workflows/repo-health.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivy-Interactive/Ivy-Tendril/repo-health.yml?branch=development&style=flat&label=CI" alt="Status do CI" /></a>
  <a href="https://tendril.ivy.app"><img src="https://img.shields.io/badge/docs-tendril.ivy.app-blue?style=flat" alt="Documentação" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Plataformas suportadas: macOS, Windows e Linux" />
</p>

<h2>Esta é uma atualização em andamento (WIP) do Tendril. Este repositório será excluído quando terminarmos</h2>

<h2>A Fábrica de Software Agêntica para Construtores 10x</h2>

<p>
Agentes de IA agora podem escrever 99% do código. Isso muda o que significa ser um desenvolvedor. Nosso papel passa a ser saber <strong>o que é um código de qualidade</strong>. Para isso, precisamos de ferramentas de desenvolvimento totalmente novas. O Tendril é essa ferramenta e substitui sua IDE em uma era agêntica.
</p>

<p>
<a href="https://youtu.be/_KVG1NnAj-8">
  <img src="../../docs/yt-thumbnail-in-two-minutes-2.png" alt="Ivy Tendril em dois minutos: assista no YouTube" width="720">
</a>
</p>

<p>https://youtu.be/_KVG1NnAj-8</p>

## Recursos

<table>
<tr>
<td width="50%" valign="middle">

### Worktrees Paralelos

Execute agentes em git worktrees isolados. Mantenha sua branch principal limpa até revisar, aprovar e mesclar as alterações.

[Documentação &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/worktrees.gif" alt="Worktrees Paralelos" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Tunelamento (Programação Remota e Móvel)

Exponha seu servidor com segurança usando Cloudflare Quick Tunnels para monitorar e direcionar execuções de agentes de qualquer lugar.

[Documentação &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/tunneling.gif" alt="Tunelamento" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Entrada por Voz e Conteúdo Rico

Dite instruções usando a entrada de voz integrada do Whisper e anexe arquivos de texto, logs ou documentos com facilidade arrastando e soltando.

[Documentação &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/voice.gif" alt="Entrada por Voz e Conteúdo Rico" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Anotações de Planos

Faça anotações diretamente nos rascunhos para atualizar automaticamente os planos com objetivos revisados para o agente.

[Documentação &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/annotation.gif" alt="Anotações de Planos" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Revisões de Código Poderosas

Revise as alterações do agente, inspecione diffs e aprove código com portões de verificação automatizados.

[Documentação &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/review.gif" alt="Revisões de Código" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Integração com GitHub e Caixa de Entrada Automatizada

Receba Issues do GitHub ou relatórios de bugs do jam.dev via webhooks para transformar planos em markdown em tarefas ativas automaticamente.

[Documentação &rarr;](https://tendril.ivy.app/docs/integrations/jamdev)

</td>
<td width="50%">
  <img src="../../src/github.gif" alt="Integração com GitHub" width="100%" />
</td>
</tr>
</table>

---

## Agentes Suportados

Funciona com **qualquer agente de CLI**: se roda no terminal, roda no Tendril.

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Logo do Claude Code" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Logo do Codex" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="Logo do GitHub Copilot" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://github.com/google-gemini/gemini-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Logo do Gemini" width="16" valign="middle" /> Gemini</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="Logo do OpenCode" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://developer.apple.com/documentation/foundationmodels"><kbd><img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" alt="Logo do Apple Foundation Models" width="16" valign="middle" /> Apple Foundation Models</kbd></a> &nbsp;
  <kbd>+ qualquer agente CLI</kbd>
</p>

## Agent Skills (Habilidades do Agente)

Estenda seus agentes de codificação por IA favoritos com habilidades oficiais de engenharia e depuração do Tendril.

### Início Rápido

Instale as habilidades do Tendril para qualquer agente suportado usando o instalador universal de skills:

```bash
npx skills add ivy-interactive/ivy-tendril
```

Ou instale uma habilidade específica:

```bash
npx skills add ivy-interactive/ivy-tendril --skill tendril-debug-plan
```

### Ferramentas e Ambientes Suportados

<details>
<summary><strong>Visual Studio Code (GitHub Copilot e Extensões)</strong></summary>

Instale skills para o GitHub Copilot no VS Code:

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot
```

Instalação global (em todos os espaços de trabalho):

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot -g
```

Ou copie as habilidades diretamente para `.agents/skills/` ou `.github/skills/` (nível do projeto) ou `~/.copilot/skills/` (global).

Depois de instaladas, as habilidades aparecem no GitHub Copilot Chat no menu `/skills` e podem ser invocadas diretamente como comandos de barra (ex.: `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`).

Extensões de agentes de terceiros para o VS Code:
- Cline: `npx skills add ivy-interactive/ivy-tendril --agent cline`
- Continue: `npx skills add ivy-interactive/ivy-tendril --agent continue`
- Roo Code: `npx skills add ivy-interactive/ivy-tendril --agent roo`

Para integração completa ao editor, instale a [Extensão Oficial do Ivy Tendril para VS Code](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) para ter painéis de planos integrados, navegação por worktrees e monitoramento de execução em tempo real.

Consulte o [Guia de Configuração do VS Code](../vscode-setup.md) para opções detalhadas de configuração.
</details>

<details>
<summary><strong>Claude Code</strong></summary>

Instale a partir do marketplace do Claude Code:

```
/plugin marketplace add ivy-interactive/ivy-tendril
/plugin install tendril-skills@ivy-tendril
```

Desenvolvimento local:

```bash
claude --plugin-dir /caminho/para/ivy-tendril
```

Consulte o [Guia de Configuração do Claude Code](../claude-setup.md) para opções detalhadas de configuração.
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

Instale o plugin via URL do Git:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril.git
```

Instalação local:

```bash
agy plugin install ./
```

Consulte o [Guia de Configuração do Antigravity](../antigravity-setup.md) para opções detalhadas de configuração.
</details>

<details>
<summary><strong>Cursor</strong></summary>

Instale com destino ao Cursor:

```bash
npx skills add ivy-interactive/ivy-tendril --agent cursor
```

Ou copie as habilidades para `.cursor/skills/` (nível de projeto) ou `~/.cursor/skills/` (global).

Consulte o [Guia de Configuração do Cursor](../cursor-setup.md) para opções detalhadas de configuração.
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Instale a partir do marketplace de plugins do Codex:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril
codex plugin add tendril-skills@tendril-skills
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Instale usando a CLI do Gemini:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril.git --path skills
```
</details>

---

## Instalação

Baixe os instaladores de desktop independentes (`.pkg`, `.AppImage`, `.exe`) diretamente das [Releases do GitHub](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) ou execute um dos comandos de instalação rápida abaixo:

**macOS / Linux:**
```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows:**
```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

### Execução

O Tendril é um aplicativo desktop, mas a mesma instalação também é uma CLI. Os dois são binários
separados: `tendril-app` é o app desktop, e `tendril` é a CLI e o servidor.

Inicie o aplicativo desktop executando o **Tendril** no menu de aplicativos (ou execute o
binário `tendril-app` diretamente).

Inicie o daemon em segundo plano sem interface gráfica — API HTTP e WebSocket, sem interface desktop:
```bash
tendril run
```

O `tendril run` verifica a porta e migra o banco de dados primeiro, depois escuta em `127.0.0.1:5010`. Use
`--port` / `--host` para alterar isso, e `tendril serve` se desejar o ouvinte simples sem verificações
prévias (também é o comando que aceita `--tls-cert` / `--tls-key`).

Tudo o mais é um subcomando — `tendril --help` lista todos eles, e `tendril doctor` gera um relatório da
instalação (código de saída 0 quando nada falha `[FAIL]`, 1 caso contrário, servindo para validação em scripts).

---

## 🏛 Estrutura de Diretórios

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   ├── tendril-app/            # App desktop Tauri + frontend React
│   │   └── tendril-docs/           # Site de documentação
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # Modelos de domínio centrais, banco de dados SQLite, motor de worktrees
│   │   ├── tendril-server/         # Servidor HTTP Axum REST & WebSocket
│   │   └── tendril-cli/            # Interface de linha de comando ("tendril")
│   ├── extensions/
│   │   └── vscode/                 # Extensão para VS Code / Antigravity IDE
│   ├── promptwares/                # Definições de agentes Promptware & firmware
│   ├── skills/                     # Habilidades de fluxo de trabalho de agentes
│   └── scripts/                    # Scripts de configuração e validação de testes
├── docs/                           # Conteúdo de documentação
├── Cargo.toml                      # Espaço de trabalho unificado do Cargo
├── pnpm-workspace.yaml             # Espaço de trabalho unificado do pnpm
└── package.json                    # Scripts raiz do workspace
```

---

## 🚀 Começando

### Pré-requisitos
- [Rust](https://rustup.rs/) (edição 2021)
- [Node.js](https://nodejs.org/) (v22+) & [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### Início Rápido

1. **Instalar dependências**:
   ```bash
   pnpm install
   ```

2. **Compilar componentes e biblioteca de interface**:
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **Executar o Storybook**:
   ```bash
   pnpm dev:storybook
   ```

4. **Compilar e executar o app desktop**:
   ```bash
   pnpm dev:app
   ```

5. **Compilar os crates de backend**:
   ```bash
   cargo build --workspace
   ```

6. **Executar testes**:
   ```bash
   # Testes web e de componentes
   pnpm test

   # Testes Rust
   cargo test --workspace
   ```

### Testes Visuais e de Captura de Tela

Para executar verificações de captura de tela e testes visuais com Storybook localmente:

```bash
pnpm install
pnpm run install:playwright:deps
```

---

## Comunidade e Suporte

- **Discord:** Junte-se à comunidade no **[Discord](https://discord.gg/FHgxkDga3y)**.
- **Feedback e Ideias:** Encontrou um bug ou tem uma ideia? [Abra uma issue](https://github.com/Ivy-Interactive/Ivy-Tendril/issues).
- **Apoie o Projeto:** Deixe uma [estrela (star)](https://github.com/Ivy-Interactive/Ivy-Tendril) neste repositório para acompanhar nosso desenvolvimento.

---

## Licença

O Tendril tem código-fonte disponível e é licenciado sob a [Functional Source License (FSL-1.1-ALv2)](../../LICENSE). Habilidades de agentes e plugins (`skills/`, `.claude-plugin/`, `.codex-plugin/`, `.agents/`) também são licenciados sob os termos do repositório raiz ([Functional Source License (FSL-1.1-ALv2)](../../LICENSE)).
