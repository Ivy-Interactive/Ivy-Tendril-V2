---
title: Configuração de Projetos
description: Cada projeto é um repositório git com suas próprias verificações e
  contexto de agente. O Tendril executa múltiplos projetos lado a lado.
icon: FolderGit
searchHints:
  - projeto
  - repo
  - repositório
  - multi-projeto
  - isolamento
  - worktree
  - zona de perigo
  - mcp
  - sandboxing
---

# Configuração de Projetos

O Tendril suporta o gerenciamento de múltiplos projetos lado a lado. Cada projeto define seus próprios repositórios [Git](https://git-scm.com), etapas de verificação, alocações de portas, variáveis de ambiente, sandboxes de segurança e habilidades personalizadas.

## Adicionando e Gerenciando Projetos

Os projetos podem ser configurados visualmente através de **Settings > Projects** ou declarando-os em `$TENDRIL_HOME/config.yaml` (consulte [Configuração e Definições](01_Setup.md)):

- **Assistente de Adição de Projeto** — Clique em **Add Project** na barra lateral de configurações para registrar um projeto com o caminho do repositório, cor inicial e etapas de verificação padrão.
- **Renomeação Inline** — Clique no ícone de lápis de edição ao lado do nome do projeto no cabeçalho para renomear um projeto. O Tendril valida contra nomes duplicados no mesmo nível e atualiza os registros de planos associados automaticamente.
- **Seletor de Amostra de Cor** — Selecione uma cor de destaque na grade de 32 amostras da paleta de cores Ivy (`ColorSwatchField`). Esta cor distingue o projeto no [Painel](../04_Apps/01_Dashboard.md), na fila de [Planos](../04_Apps/03_Plans.md), na fila de [Revisão](../04_Apps/02_Review.md) e no rastreador de [Pull Requests](../04_Apps/06_PullRequests.md).
- **Contexto** — Instruções em Markdown descrevendo a terminologia do domínio, restrições arquiteturais e padrões de código. Este contexto é anexado no início das instruções de promptware para todas as execuções de agentes no projeto.

### Exemplo de `config.yaml`

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Core engine services written in Rust with a TypeScript CLI.
      Follow standard Ivy design tokens and ensure all tests pass.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
    reviewActions:
      - name: Run E2E
        command: pnpm test:e2e
        condition: "${hasChanges}"
    ports:
      backend:
        defaultPort: 8080
        description: API gateway service
    envFiles:
      - path: .env
        template: .env.example
        overrides:
          PORT: "${ports.backend}"
          DATABASE_URL: "sqlite://${env.TENDRIL_HOME}/dev.db"
    wireframes: true
    wireframeGuard: true
    sandboxMode: Off
    securityPreset: Standard
```

## Repositórios e Git Worktrees

Os projetos do Tendril vinculam um ou mais repositórios [Git](https://git-scm.com) (`repos:`).

Quando um agente executa um plano via `ExecutePlan`, ele isola a geração de código do seu ambiente de desenvolvimento local:

- **Git Worktrees Dedicados** — O Tendril cria uma branch isolada de Git worktree (`tendril/<planId>-<slug>`) ramificada a partir da sua branch de destino. Sua árvore de trabalho, branch e IDE permanecem intactos.
- **Execução Concorrente** — Vários planos podem ser executados simultaneamente em diferentes repositórios sem contenção de bloqueio do git.
- **Falha Segura e Descarte** — Execuções com falha ou rejeitadas podem ser descartadas de forma limpa, sem a necessidade de limpezas manuais do git.
- **Worktree Reaper** — A limpeza automatizada em segundo plano remove worktrees ociosos ou concluídos de acordo com as configurações `worktreeReaperInterval` e `worktreeReaperGrace` em [Configuração e Definições](01_Setup.md).

## Pipelines de Verificação

Os projetos definem uma sequência ordenada de etapas de verificação que os agentes devem cumprir antes que o trabalho chegue à [Revisão](../04_Apps/02_Review.md):

- **Ordem Reordenável** — Arraste e solte as etapas de verificação na sequência de execução desejada (`SortableVerificationList`).
- **Etapas Obrigatórias** — Marque verificações como obrigatórias. Um plano só aparece como `Verified` na [Revisão](../04_Apps/02_Review.md) se todas as verificações obrigatórias forem bem-sucedidas.
- **Verificações Personalizadas** — Adicione comandos específicos do projeto e prompts de verificação personalizados (por exemplo, `cargo clippy`, `pnpm check`, `pytest`). Consulte [Verificação via CLI](../09_Advanced/01_CLI/03_Verification.md) para gerenciamento por linha de comando.

## Ações de Revisão

Defina botões de ação de um clique renderizados na barra de ferramentas do aplicativo [Revisão](../04_Apps/02_Review.md) (`reviewActions:`):

- `name` — Rótulo da ação exibido no botão da barra de ferramentas.
- `command` — Comando de shell executado na worktree do plano.
- `condition` — Condição opcional de execução (como `${hasChanges}`).

## Portas e Arquivos de Ambiente

Projetos complexos frequentemente exigem portas isoladas e configurações de ambiente:

- **Alocações de Portas (`ports:`)** — Declare portas nomeadas (por exemplo, `backend`, `frontend`). Se a porta padrão já estiver em uso, o Tendril aloca uma porta aberta e a expõe por meio de placeholders `${ports.<name>}`.
- **Arquivos de Ambiente (`envFiles:`)** — Recrie automaticamente arquivos `.env` dentro das worktrees dos agentes a partir de um modelo base (por exemplo, `.env.example`) e substituições chave/valor linha por linha compatíveis com variáveis `${ports.<name>}`, `${env.<VAR>}` e `%VAR%`.

## Segurança do Agente e Sandboxing

O Tendril oferece controles de segurança granulares no nível do projeto:

- **Predefinições de Segurança** — Selecione `Strict`, `Standard`, `Permissive` ou `Custom`. As predefinições configuram regras padrão de sandboxing e acesso a arquivos.
- **Modo Sandbox** — Selecione o isolamento em tempo de execução: `Off`, [Docker](https://www.docker.com) ou [Bubblewrap](https://github.com/containers/bubblewrap).
- **Acesso a Arquivos Externos** — Controle se os agentes podem ler arquivos fora da árvore do repositório (`Deny`, `ReadOnly`, `Full`).
- **Autoexecução no Terminal** — Escolha se os agentes executam comandos de shell automaticamente (`AllowAll`), solicitam confirmação (`RequireConfirmation`) ou negam a execução de comandos (`DenyAll`).
- **Permissões de Arquivo** — Configure regras granulares de caminho: `Allow <path>`, `Ask <path>` ou `Deny <path>`.
- **Wireframes e Wireframe Guard** — Ative `wireframes` para habilitar a geração de protótipos de UI em planos e ative `wireframeGuard` para verificar se o código temporário de wireframes é inspecionado antes de chegar aos pull requests de produção.

## Servidores MCP e Habilidades do Projeto

Estenda os recursos do agente para um projeto específico:

- **Servidores MCP (`mcpServers:`)** — Registre servidores [Model Context Protocol](https://modelcontextprotocol.io) no escopo do projeto com executáveis, argumentos e variáveis de ambiente personalizados. Consulte [Integração MCP](../09_Advanced/03_MCP.md).
- **Habilidades (`skills:`)** — Equipe agentes com procedimentos específicos do projeto e instruções em markdown. Consulte o [Guia de Habilidades](../06_CodingAgents/00_Skills.md).

## Contexto Local do Repositório

O Tendril detecta e anexa automaticamente a documentação da raiz do repositório ao início do contexto do promptware:

- **`CLAUDE.md`** — Orientações e convenções para o Claude Code. Consulte o [Guia do Claude Code](../06_CodingAgents/01_ClaudeCode.md).
- **`AGENTS.md` / `DEVELOPER.md`** — Padrões de desenvolvimento da equipe, requisitos de testes e convenções da base de código.

## Zona de Perigo: Remover vs. Excluir

As configurações do projeto são finalizadas com duas opções distintas de destruição na Zona de Perigo:

```
[ Remove Project ]  (Outline)
Removes the project from config.yaml. Cloned repositories, plan folders and history
are left on disk, so adding the project back by name restores it.

[ Delete Project ]  (Destructive)
Permanently deletes the project's plans, its cloned repositories under
<TENDRIL_HOME>/Projects/, its database rows and its config entry. This cannot be
undone, and asks you to type the project name first.
```

> [!WARNING]
> **Remove Project** apenas desregistra o projeto da configuração, mantendo os arquivos intactos no disco. **Delete Project** remove permanentemente repositórios, planos e registros de banco de dados, exigindo a digitação do nome exato do projeto para confirmação.
