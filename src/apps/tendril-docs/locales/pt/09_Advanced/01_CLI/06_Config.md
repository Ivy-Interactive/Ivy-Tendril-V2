---
title: config
description: Obtenha e defina configurações de nível superior do Tendril
  armazenadas em config.yaml diretamente pela linha de comando.
icon: Settings
searchHints:
  - config
  - configuração
  - configurações
  - jobTimeout
  - codingAgent
  - planTemplate
  - gitTimeout
  - daemonRequestTimeout
  - llm
---

# config

Obtenha e defina configurações de nível superior do Tendril armazenadas no formato [YAML](https://yaml.org) dentro de `config.yaml` — os mesmos valores globais gerenciados em Configurações nas interfaces desktop e web. Consulte o [Guia de Instalação](../../03_Configuration/01_Setup.md) para obter mais detalhes sobre o ambiente e o layout dos diretórios.

## Comandos

```terminal
>tendril config get <key>
>tendril config set <key> <value>
```

- **`get`** — Exibe o valor bruto na saída padrão sem formatação decorativa, tornando-o ideal para scripts de shell e redirecionamento direto para arquivos ou outras ferramentas.
- **`set`** — Valida e atualiza o valor em `config.yaml`. As chaves não diferenciam maiúsculas de minúsculas.

## Chaves Primitivas

O Tendril modela diversas chaves de configuração primitivas com validação de tipo:

| Chave                          | Tipo                                | Padrão             | Descrição                                                                                                                                                  |
| ------------------------------ | ----------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codingAgent`                  | string                              | `claude`           | Executável ou alias padrão do agente de código (ex.: `claude`, `aider`, `codestory`).                                                                      |
| `jobTimeout`                   | inteiro (minutos)                   | `120`              | Tempo limite máximo de execução para um trabalho de plano em execução.                                                                                     |
| `staleOutputTimeout`           | inteiro (minutos)                   | `10`               | Tempo de inatividade antes que um trabalho sem saída seja marcado como estagnado.                                                                          |
| `gitTimeout`                   | inteiro (minutos)                   | `5`                | Tempo limite de comando para operações do [Git](https://git-scm.com).                                                                                      |
| `daemonRequestTimeout`         | inteiro (segundos)                  | `30`               | Tempo limite em segundos para requisições HTTP ao daemon local do Tendril (`0` ou negativo desativa).                                                      |
| `maxConcurrentJobs`            | inteiro                             | `2`                | Número máximo de trabalhos de execução simultâneos permitidos.                                                                                             |
| `planTemplate`                 | string                              | `""`               | Modelo em [Markdown](https://daringfireball.net/projects/markdown/) prefixado ao criar novos planos.                                                       |
| `planFolder`                   | string (opcional)                   | `None`             | Diretório personalizado no sistema de arquivos onde os arquivos markdown de plano são armazenados. Passe `""` para desmarcar.                              |
| `promptwareOverlay`            | string (opcional)                   | `None`             | Caminho para um diretório de sobreposição contendo promptwares personalizados. Passe `""` para desmarcar.                                                  |
| `telemetry`                    | booleano (opcional)                 | `None`             | Alternador de telemetria anônima opcional (`true` ou `false`). Passe `""` para limpar.                                                                     |
| `beta`                         | booleano                            | `false`            | Habilita recursos experimentais de visualização prévia (`true` ou `false`).                                                                                |
| `desktopNotifications`         | booleano                            | `true`             | Habilita notificações de desktop do sistema para status do plano e conclusões do agente (`true` ou `false`).                                               |
| `theme`                        | string                              | `default`          | ID do preset de cores da interface (ex.: `default`, `dracula`).                                                                                            |
| `worktreeReaperInterval`       | inteiro (minutos)                   | `60`               | Frequência das passagens automatizadas do limpador de worktrees do [Git](https://git-scm.com) (`0` ou negativo desativa).                                  |
| `worktreeReaperGrace`          | inteiro (minutos)                   | `1440`             | Período de carência ocioso em minutos antes que uma worktree inativa seja considerada elegível para limpeza.                                               |
| `worktreeBranchDeleteMode`     | string                              | `PreserveUnpushed` | Modo de segurança de exclusão de branch na limpeza de worktree (`PreserveUnpushed` ou `Force`).                                                            |
| `coAuthor`                     | string (opcional)                   | `None`             | Identidade de atribuição de trailer do [Git](https://git-scm.com) no formato `Nome <email>` adicionada a commits automatizados. Passe `""` para desmarcar. |
| `enrichModels`                 | booleano                            | `true`             | Habilita a descoberta e enriquecimento automático de modelos em segundo plano (`true` ou `false`).                                                         |
| `modelEnrichmentIntervalHours` | inteiro (horas)                     | `24`               | Intervalo de atualização em segundo plano para metadados de modelo.                                                                                        |
| `modelCacheWarnAgeDays`        | inteiro (dias)                      | `7`                | Limite de idade suave antes que o cache de modelos obsoleto produza avisos.                                                                                |
| `modelCacheMaxAgeDays`         | inteiro (dias)                      | `30`               | Limite de idade rígido após o qual os metadados de modelos em cache expiram.                                                                               |
| `llm`                          | objeto [JSON](https://www.json.org) | `None`             | Configuração de endpoint, chave de API e modelo para o serviço auxiliar de LLM. Mesclado com os campos existentes.                                         |

> [!NOTE]
> Chaves escalares não modeladas também podem ser armazenadas e recuperadas; elas são salvas em uma tabela de atributos extras no `config.yaml`.

## Chaves Estruturadas

As configurações do Tendril também contêm listas e mapas estruturados que não podem ser definidos ou recuperados via `tendril config`:

- `projects` — Definições de projetos configurados (gerencie usando [`tendril project`](02_Project.md)).
- `verifications` — Definições globais de suítes de verificação (gerencie usando [`tendril verification`](03_Verification.md)).
- `levels` — Níveis de complexidade de plano e vínculos de verificação.
- `onboarding` — Estados de conclusão do assistente de primeira execução.
- `codingAgents` — Caminhos de binários, argumentos, variáveis de ambiente e perfis por agente.
- `promptwares` — Instruções, perfis e regras de ferramentas por promptware.
- `inbox` — Regras de notificações recebidas e integrações de entrega.

Tentar executar `tendril config get` ou `tendril config set` em qualquer chave estruturada exibirá um erro direcionando você a usar o comando CLI dedicado ou editar o `config.yaml` diretamente.

## Exemplos

```terminal
># Ler um valor de configuração
>tendril config get jobTimeout

># Atualizar uma configuração numérica ou de texto
>tendril config set jobTimeout 60
>tendril config set codingAgent claude

># Alternar opções booleanas
>tendril config set desktopNotifications false
>tendril config set beta true

># Mesclar configuração auxiliar de LLM
>tendril config set llm '{"model":"gpt-4o"}'

># Limpar uma configuração opcional passando uma string vazia
>tendril config set coAuthor ""
>tendril config set planFolder ""

># Definir um modelo de plano multilinha usando substituição de comando de shell
>tendril config set planTemplate "$(cat template.md)"

># Exportar o modelo de plano de volta para um arquivo
>tendril config get planTemplate > template.md
```

> [!TIP]
> Ao atribuir textos de múltiplas linhas, como `planTemplate`, ou objetos [JSON](https://www.json.org), como `llm`, use aspas no shell ou substituição de comando (`"$(cat file.md)"`) para garantir que os valores sejam transmitidos corretamente como um único argumento.
