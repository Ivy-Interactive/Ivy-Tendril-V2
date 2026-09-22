---
title: Promptwares
description: Promptwares são os agentes de fluxo de trabalho de propósito único
  por trás de cada estágio do plano — cada um com seu próprio prompt,
  ferramentas e memória de longo prazo.
icon: Terminal
searchHints:
  - promptware
  - agente
  - prompt
  - ferramentas
  - memória
  - allowedTools
  - perfil
  - customInstructions
  - camadas
---

# Promptwares

Um promptware é um diretório contendo as instruções, ferramentas e memória que definem um agente de
fluxo de trabalho de propósito único. Cópias implantadas ficam sob `$TENDRIL_HOME/Promptwares/`, uma por promptware:

- **Program.md** — o prompt do sistema: o objetivo do agente, procedimento passo a passo e regras de execução.
- **Tools/** — scripts executáveis e utilitários que o agente pode chamar durante sua execução.
- **Memory/** — notas persistentes em Markdown que sobrevivem entre as execuções. Esse loop de feedback permite que os promptwares
  aprendam idiossincrasias da base de código e melhorem em vez de repetir erros.

O Tendril despacha promptwares através do seu agente de programação configurado (como
[Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Codex](../06_CodingAgents/02_Codex.md),
[Copilot](../06_CodingAgents/03_Copilot.md), [Gemini](../06_CodingAgents/05_Gemini.md),
[OpenCode](../06_CodingAgents/04_OpenCode.md), Antigravity ou [Cursor](https://www.cursor.com)), executando
uma tarefa por vez com concessões de ferramentas de menor privilégio.

## Implantação e camadas

O Tendril vem com um conjunto padrão de promptwares integrados à plataforma. As equipes também podem configurar um diretório
de sobreposição (overlay) em [config.yaml](../03_Configuration/01_Setup.md) para substituir prompts do sistema ou fornecer
ferramentas personalizadas da equipe.

Implantar ou atualizar promptwares:

```bash
tendril promptware deploy
```

Para inspecionar se um promptware está sendo executado a partir da linha de base integrada ou de uma sobreposição da equipe:

```bash
tendril promptware layers
# ou verificar um promptware específico:
tendril promptware layers ExecutePlan
```

## Agentes principais de fluxo de trabalho

| Promptware       | Papel                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **CreatePlan**   | Elaborar um plano a partir de um breve resumo, um item da caixa de entrada ou uma issue do [GitHub](https://github.com). |
| **ExpandPlan**   | Desenvolver um plano básico transformando-o em uma especificação implementável com fases.                                |
| **UpdatePlan**   | Revisar um plano existente a partir do feedback do revisor, chat e anotações inline.                                     |
| **SplitPlan**    | Dividir um plano grande em subplanos menores e independentes.                                                            |
| **ExecutePlan**  | Criar [git worktrees](https://git-scm.com/docs/git-worktree) isoladas, implementar fases do plano, executar testes.      |
| **RetryPlan**    | Fazer outra passagem em um plano que falhou na verificação, utilizando logs e diffs.                                     |
| **CreatePr**     | Abrir um pull request no GitHub a partir dos diffs da worktree usando o [GitHub CLI](https://cli.github.com/) (`gh`).    |
| **CreateIssue**  | Enviar uma falha de plano, estado ou solicitação de triagem para as issues do GitHub.                                    |
| **AddProject**   | Registrar um novo projeto e configurar os caminhos do seu repositório.                                                   |
| **SetupProject** | Descobrir e registrar como um projeto compila, executa e verifica.                                                       |
| **SyncRepo**     | Atualizar os repositórios de um projeto com as branches upstream.                                                        |

## Configuração

Cada promptware é configurado em [~/.tendril/config.yaml](../03_Configuration/01_Setup.md) sob a
chave `promptwares:`:

```yaml
promptwares:
  _default:
    profile: balanced

  CreatePlan:
    profile: deep
    allowedTools:
      - Read
      - Glob
      - Grep
      - Bash
      - Write(%PLANS_DIR%/**)
    deniedTools:
      - WebFetch
    customInstructions: |
      Always include acceptance criteria and verification gates in the plan.
```

| Campo                | Obrigatório | Descrição                                                                                                                                                                      |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile`            | Sim         | Qual perfil de agente usar — `quick`, `balanced` ou `deep`. Os perfis mapeiam para um modelo e um nível de esforço por agente.                                                 |
| `allowedTools`       | Não         | Ferramentas concedidas além dos padrões integrados. Suporta as variáveis `%PROMPTWARE_DIR%`, `%PLAN_DIR%` e `%PLANS_DIR%` para delimitar as permissões a caminhos específicos. |
| `deniedTools`        | Não         | Ferramentas negadas, mesmo que alguma outra configuração as tenha concedido.                                                                                                   |
| `customInstructions` | Não         | Texto livre injetado no prompt do agente com marcadores de prioridade de substituição.                                                                                         |

A entrada `_default` é uma linha de base aplicada a todos os promptwares; uma entrada nomeada a substitui.

### Instruções personalizadas

Quando `customInstructions` é definido, o Tendril o anexa ao prompt compilado de firmware com um marcador
explícito de prioridade. O agente é instruído a segui-lo em detrimento tanto do template de firmware quanto do próprio
`Program.md` do promptware. Use-o para substituições de comportamento por promptware sem editar arquivos de programa compartilhados.

## Fluxo de execução

1. **Contexto** — compila o `Program.md`, anexa o plano, anotações inline, configuração do projeto e
   quaisquer `customInstructions` do `config.yaml`.
2. **Ferramentas e permissões** — expõe `Tools/` e as permissões de ferramentas configuradas, expandindo variáveis `%...%`
   para caminhos absolutos. Diretórios graváveis são estritamente delimitados à pasta do plano, à `Memory/` do promptware
   e às git worktrees do repositório.
3. **Execução** — inicia o agente de programação como um processo de trabalho em segundo plano em sua worktree isolada.
4. **Captura e telemetria** — transmite a saída em tempo real para `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`,
   emite o progresso para o daemon e registra o uso e custo de tokens no `costs.csv` do plano.

## Memória e aprendizado

A memória é o loop de feedback: um promptware anota o que aprendeu sobre um projeto ou modo de falha
e o lê novamente em execuções futuras. A CLI expõe o gerenciamento de memória diretamente:

```bash
# Listar notas de memória armazenadas para um promptware
tendril promptware list-memory ExecutePlan

# Ler notas de memória específicas
tendril promptware read-memory ExecutePlan worktree-hygiene.md

# Gravar ou atualizar uma nota de memória a partir de um arquivo (ou stdin)
tendril promptware write-memory ExecutePlan worktree-hygiene.md --file notes.md

# Excluir uma nota de memória obsoleta ou incorreta
tendril promptware delete-memory ExecutePlan worktree-hygiene.md
```

> [!TIP]
> A memória deve ser tanto podada quanto cultivada — uma suposição ou regra que se tornou obsoleta deve
> ser excluída com `delete-memory`, e não enterrada sob notas contraditórias.

## Execução direta

Para testar ou executar um promptware diretamente em primeiro plano, ignorando o serviço de jobs do daemon:

```bash
# Executar CreatePlan diretamente com um prompt de tarefa
tendril promptware run CreatePlan "Add a health-check endpoint" --profile deep

# Imprimir o prompt de firmware compilado sem iniciar o agente
tendril promptware run CreatePlan "Add a health-check endpoint" --dry-run
```

## Próximos passos

- [Ciclo de vida e tarefas](03_Lifecycle.md) — como é uma execução de promptware enquanto ela acontece.
- [Planos](01_Plans.md) — o artefato que todo promptware lê e grava.
