---
title: Visão Geral da CLI
description: Gerencie planos, projetos, bancos de dados e agentes diretamente do
  seu terminal. O binário tendril funciona tanto como um daemon de servidor
  quanto como uma ferramenta de CLI completa.
icon: Terminal
searchHints:
  - cli
  - comando
  - terminal
  - tendril
  - shell
  - redefinir
  - reportar-bug
  - executar
  - servir
  - doutor
  - versão
  - configuração
---

# Visão Geral da CLI

Gerencie planos, projetos, bancos de dados e agentes diretamente do seu terminal. O binário `tendril` funciona tanto como um daemon de servidor quanto como uma ferramenta de CLI completa.

A CLI do Tendril oferece controle total sobre o seu fluxo de trabalho sem precisar tocar na interface gráfica (UI):

- **Planos** — crie, liste, atualize e inspecione planos; gerencie repositórios, worktrees, verificações e recomendações
- **Projetos** — configure projetos, seus repositórios, dependências de compilação, ações de revisão, servidores MCP e skills personalizadas
- **Verificações** — defina e gerencie verificações reutilizáveis
- **Configuração** — leia e atualize configurações de nível superior armazenadas em `config.yaml`
- **Vault** — conecte vaults de equipe, descubra repositórios remotos, sincronize recursos e importe ou envie projetos
- **Banco de Dados** — execute migrações, inspecione versões de schema, redefina tabelas, verifique integridade e execute vacuum
- **Agentes e Trabalhos** — execute promptwares, gerencie trabalhos em segundo plano e conduza sessões de chat interativas

## Início Rápido

**1. Verifique sua instalação**

```terminal
>tendril doctor
```

**2. Inicie o servidor daemon**

```terminal
>tendril run
```

**3. Crie um novo plano**

```terminal
>tendril plan create "Fix login bug" MyProject
```

**4. Liste os planos ativos**

```terminal
>tendril plan list --state Executing
```

**5. Redefina tudo e comece do zero**

```terminal
>tendril reset
```

> [!TIP]
> Todos os comandos suportam `--help` para obter informações detalhadas de uso. Por exemplo: `tendril plan create --help`.

## Opções Globais

| Flag            | Efeito                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `--home <path>` | Caminho para o diretório home do Tendril (também pode ser definido via variável de ambiente `TENDRIL_HOME`) |

## Variáveis de Ambiente

| Variável        | Finalidade                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TENDRIL_HOME`  | Diretório raiz para configuração, banco de dados, caixa de entrada (inbox) e planos (o padrão é `~/.tendril` ou `D:\.tendril`)                                                       |
| `TENDRIL_PLANS` | Substitui o diretório de planos (o padrão é `TENDRIL_HOME/Plans`)                                                                                                                    |
| `RUST_LOG`      | Diretiva de filtro para logs de processo em stderr (padrão: `warn,tendril_cli=info,tendril_core=info,tendril_server=info`). Defina como `debug` para logs detalhados de diagnóstico. |

## Comandos Comuns

#### doctor

```terminal
>tendril doctor
>tendril doctor --rebuild-search-index
```

Valida sua instalação do Tendril — verifica `TENDRIL_HOME`, `config.yaml`, ferramentas necessárias (`git`, `gh`), conectividade com o banco de dados e disponibilidade dos modelos de agentes. Use `--rebuild-search-index` para regenerar o índice de busca em texto completo a partir do banco de dados.

#### plan doctor

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

Analisa cada pasta de plano e relata a integridade: `plan.yaml` ausente ou malformatado, worktrees obsoletas e planos deixados como `Completed` após uma falha de verificação. Consulte [Plan](01_Plan.md#doctor) para a referência completa de opções e códigos de integridade.

#### serve e run

```terminal
>tendril serve --port 5010 --host 127.0.0.1
>tendril serve --tls-cert /path/localhost.crt --tls-key /path/localhost.key
>tendril run
```

`tendril serve` inicia o servidor de API HTTP e WebSocket (porta padrão `5010`, host `127.0.0.1`). As flags opcionais `--tls-cert` e `--tls-key` servem via HTTPS.

`tendril run` verifica se a porta de destino está disponível, aplica automaticamente quaisquer migrações pendentes do banco de dados e, em seguida, inicia o daemon.

#### reset

```terminal
>tendril reset
>tendril reset --force
```

Remove todos os dados do Tendril da máquina — exclui `TENDRIL_HOME` e `TENDRIL_PLANS`. Solicita confirmação a menos que `--force` seja fornecido.

> [!WARNING]
> Isso exclui permanentemente todos os planos, trabalhos e dados de configuração nos diretórios de destino.

#### report-bug

```terminal
>tendril report-bug --plan 00042
>tendril report-bug --job 00150 -d "Agent failed to create worktree"
>tendril report-bug --plan 00042 --out ~/Desktop/diagnostics.zip
>tendril report-bug --plan 00042 --submit --yes
```

Coleta arquivos de planos e todos os artefatos de trabalhos — Job Log, Job Prompt, Job Raw Log e Job Eventwire Log de `<TendrilHome>/Jobs/` — em um arquivo zip com configuração sanitizada e diagnósticos de integridade. Quando `--submit` e `--yes` são fornecidos, faz o upload do arquivo e abre uma issue no GitHub.

| Opção                   | Efeito                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `--plan <id>`           | Inclui esta pasta de plano e todos os trabalhos executados nela        |
| `--job <id>`            | Inclui os quatro artefatos deste trabalho mais o contexto do seu plano |
| `-d, --description <t>` | Descrição do bug (solicitada interativamente se omitida)               |
| `--out <path>`          | Caminho de destino para o arquivo zip                                  |
| `--github-user <name>`  | Nome de usuário do GitHub para acompanhamento da issue                 |
| `--submit`              | Faz o upload do relatório para o GitHub (requer `--yes`)               |
| `-y, --yes`             | Pula a solicitação de confirmação                                      |

> [!WARNING]
> O envio de um relatório anexa o pacote zip a uma issue **pública** do GitHub. Segredos são removidos das configurações e dos logs de trabalhos, mas revise o conteúdo do plano antes de enviar.

#### version

```terminal
>tendril version
```

Exibe a versão instalada do Tendril (ex.: `tendril v2.0.0`).

#### update-promptwares

```terminal
>tendril update-promptwares
>tendril update-promptwares --dry-run
>tendril update-promptwares --source /path/to/promptwares
```

Atualiza os promptwares implantados em `<TendrilHome>/Promptwares/`, preservando seus diretórios `Memory/` e `Tools/`.

## Próximos Passos

- [Comandos de Plan](01_Plan.md) — referência completa para criar e gerenciar planos
- [Comandos de Project](02_Project.md) — configure projetos, repositórios, ações de revisão, servidores MCP e skills
- [Comandos de Verification](03_Verification.md) — gerencie definições globais de verificação
- [Comandos de Database](04_Database.md) — migrações, versão de schema, integridade e vacuum
- [Outros comandos](05_Other.md) — promptware, trabalho, chat, serviço e utilitários
- [Comandos de Config](06_Config.md) — leia e atualize configurações de nível superior em `config.yaml`
- [Comandos de Vault](07_Vault.md) — conecte vaults de equipe, sincronize recursos e importe ou publique projetos
