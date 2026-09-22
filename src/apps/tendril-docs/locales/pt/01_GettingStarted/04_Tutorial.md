---
title: Tutorial
description: "Um passo a passo completo de ponta a ponta: compile o Tendril,
  registre um repositório local, crie seu primeiro plano, execute-o com um
  agente, revise o resultado e abra uma pull request."
icon: GraduationCap
searchHints:
  - tutorial
  - passo a passo
  - início rápido
  - primeiro plano
  - ponta a ponta
  - exemplo
---

# Tutorial

Este é o fluxo de trabalho completo de ponta a ponta em um repositório de sua escolha. Ele abrange o registro de um projeto,
a geração de um plano, a execução de alterações em worktrees isoladas, a revisão de diffs e o envio de uma pull request.

## Passo 1: Compilar e verificar

Siga a [Instalação](02_Installation.md) para instalar ou compilar o Tendril e adicionar o `tendril` ao seu `PATH`.
Verifique seu ambiente:

```bash
tendril doctor
```

O comando `tendril doctor` audita o `$TENDRIL_HOME`, o `config.yaml`, o banco de dados [SQLite](https://www.sqlite.org), o
diretório de planos, o [Git](https://git-scm.com/) e a [GitHub CLI](https://cli.github.com/) (`gh`). Resolva quaisquer
itens com `[FAIL]` antes de prosseguir.

## Passo 2: Iniciar o Tendril

Inicie o aplicativo desktop:

```bash
pnpm dev:desktop
```

O aplicativo desktop é iniciado e supervisiona automaticamente o daemon `tendril run` em segundo plano. O
daemon expõe a API REST e WebSocket através da qual a interface desktop e a CLI se comunicam.

Se você preferir executar o daemon em modo headless (sem interface gráfica):

```bash
# Checks port and runs pending migrations
tendril run

# Or direct listener with custom options:
tendril serve --host 127.0.0.1 --port 5010
```

## Passo 3: Registrar seu repositório

O Tendril requer um repositório git local para operar:

```bash
git clone https://github.com/your-org/your-repo.git
```

Registre o projeto a partir de **Settings → Projects** no aplicativo desktop, ou via CLI:

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

Ambos os métodos atualizam o `$TENDRIL_HOME/config.yaml`, que você também pode editar manualmente:

```yaml
codingAgent: claude

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

Configure `codingAgent` com o seu agente instalado:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` via on-device `fm`)

> [!TIP]
> Adicione um arquivo `AGENTS.md` na raiz do seu repositório detalhando convenções arquiteturais e comandos de compilação.
> O Tendril injeta isso no contexto de sistema do agente em cada execução. Consulte
> [Integrando uma Base de Código](03_Onboarding.md) para recomendações.

## Passo 4: Criar um plano

Clique em **New Plan** no aplicativo desktop e forneça uma descrição da tarefa. O Tendril aciona o
agente de fluxo de trabalho [CreatePlan](../02_Concepts/02_Promptwares.md), elaborando um plano
estruturado que contém a declaração de problemas, soluções em fases e metas de verificação.

Você também pode criar planos a partir da CLI:

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

O plano entra em **Draft**. Abra o rascunho do plano para inspecionar a especificação proposta. Você pode adicionar anotações
em linha diretamente na interface para corrigir o escopo ou adicionar restrições, solicitando que o
[UpdatePlan](../02_Concepts/02_Promptwares.md) sintetize seu feedback em uma
revisão atualizada.

## Passo 5: Executar o plano

Assim que o rascunho atender aos seus requisitos, clique em **Execute** (ou execute `tendril plan execute <plan-id>`).
O agente [ExecutePlan](../02_Concepts/02_Promptwares.md):

1. cria uma [Git worktree](https://git-scm.com/docs/git-worktree) isolada sob `Worktrees/{repo-name}/`,
   mantendo seu branch principal intocado;
2. carrega a especificação do plano, o contexto do repositório e as notas de memória;
3. implementa as modificações de código fase por fase com commits incrementais no git;
4. executa cada etapa de verificação configurada (build, lint, testes, capturas de tela).

Monitore a execução em tempo real na visualização de **Jobs** no desktop ou via CLI:

```bash
tendril job list          # view job statuses
tendril job queue         # inspect dispatch queue order
```

Quando todas as fases forem concluídas e as verificações obrigatórias passarem, o plano transita para **Review**.

> [!NOTE]
> Se uma verificação falhar, o plano entrará em **Failed** e a worktree será preservada no disco. Inspecione
> o relatório de erros em `Verification/` ou execute
> [RetryPlan](../02_Concepts/02_Promptwares.md) para permitir que o agente corrija o problema.

## Passo 6: Revisar o resultado

Navegue até a tela de **Review** do plano para inspecionar o trabalho:

- **Git Diff** — navegue por diffs com destaque de sintaxe em todos os arquivos afetados;
- **Relatórios de Verificação** — revise as saídas automatizadas de build e testes;
- **Transcrições de Execução** — leia os rastros de chamadas de ferramentas, stdout/stderr e custos de tokens;
- **Recomendações de Acompanhamento** — inspecione débitos técnicos ou melhorias sinalizadas pelo agente.

Aprove o plano quando estiver satisfeito. O Tendril aciona o
[CreatePr](../02_Concepts/02_Promptwares.md) para abrir uma pull request via
[GitHub CLI](https://cli.github.com/) (`gh`), movendo o plano para **Completed**.

## O que acabou de acontecer

Você completou o ciclo de desenvolvimento padrão do Tendril:

```
Draft → Creating → Executing → Review → Completed
```

O agente autônomo operou em uma worktree em sandbox, satisfez suas etapas de verificação e gerou uma
pull request auditada enquanto gravava todos os prompts, diffs e custos em `$TENDRIL_HOME/Plans/`.

## Próximos passos

- [Planos](../02_Concepts/01_Plans.md) — aprofunde-se na estrutura, estados e anotações de planos.
- [Promptwares](../02_Concepts/02_Promptwares.md) — personalize prompts, ferramentas e memória de agentes de fluxo de trabalho.
- [Ciclo de Vida e Tarefas](../02_Concepts/03_Lifecycle.md) — entenda concorrência, enfileiramento e telemetria.
