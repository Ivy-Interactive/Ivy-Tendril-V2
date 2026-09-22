# Política de Classificação de Dados de Telemetria

## Objetivo

Este documento define quais dados o Tendril pode e não pode enviar para serviços terceirizados de telemetria (PostHog). O objetivo é coletar análises úteis, respeitando a privacidade do usuário.

A política acompanha o código: ela foi portada do `TELEMETRY.md` do aplicativo original Tendril e ajustada para os eventos efetivamente integrados na V2.

## Aceitação Explícita (Opt-in), Não Exclusão (Opt-out)

**A telemetria está desativada, a menos que você a ative explicitamente.** Somente um `telemetry: true` explícito no `config.yaml` a habilita; uma chave ausente e `telemetry: false` se comportam de forma idêntica — nenhum cliente é construído, nenhum evento é colocado na fila e nenhuma chamada de rede é tentada. A chave é lida em exatamente um lugar: `TendrilSettings::telemetry_enabled` em [config.rs](../../src/crates/tendril-core/src/config.rs), e a V2 nunca *introduz* a chave: salvar um `config.yaml` que não a possui a mantém ausente em vez de gravar `telemetry: false`. Dessa forma, o ciclo de leitura e gravação de um arquivo compartilhado com o aplicativo original — que interpreta uma chave ausente como "ativada" — não desativa a telemetria desse aplicativo. Um valor explícito permanece inalterado.

**Esta é uma divergência deliberada.** O aplicativo original funciona com opt-out: ele define `Telemetry` como `true` por padrão e seu próprio `TELEMETRY.md` declara "A telemetria é opt-out: ela fica ativada por padrão". A V2 adota desativada por padrão porque ativar a coleta de dados não é uma decisão que uma versão portada deva tomar silenciosamente em nome do usuário. A divergência é segura em apenas uma direção — a V2 reporta menos em relação ao original, nunca em excesso. Para revertê-la, altere o padrão do campo e a implementação de `Default` em [config.rs](../../src/crates/tendril-core/src/config.rs) de volta para `Some(true)`.

Os usuários são identificados exclusivamente por um UUID aleatório persistido em `<TendrilHome>/.anonymous-id`. Ele nunca é derivado de um nome de usuário, nome da máquina ou repositório. (O original prefere `<LocalAppData>/Tendril/.anonymous-id`; portanto, uma máquina executando ambos os aplicativos conta como duas instalações.)

## Regras de Classificação

### PERMITIDO — Dados Agregados e Não Identificáveis

- **Contagens**: número de projetos, repositórios, planos, jobs (apenas totais agregados)
- **Durações**: tempo gasto para concluir operações, em segundos
- **Estados/Tipos**: valores de enum, nomes de estado, tipos de trabalho (ex.: `CreatePlan`, `ExecutePlan`)
- **Níveis**: níveis de plano (ex.: `Bug`, `Feature`, `Epic`)
- **Versões**: strings de versão do aplicativo, nome e strings de versão do SO
- **Provedores de agentes**: nome do agente de codificação (ex.: `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity`, `apple`, `ivy`)
- **Booleanos**: feature flags, estados de configuração (ex.: `llm_configured: true`)
- **Descritores de tecnologia**: o hash do stack do projeto (veja abaixo)
- **Hashes unidirecionais com sal de instalação** de identificadores de outra forma proibidos (veja abaixo)

#### Hash do stack (`stack_hash`)

O hash descritor do stack é uma assinatura canônica que preserva a similaridade da pilha de tecnologia de um projeto, por exemplo, `fe.ts:react+next+tailwind/be.rs:axum/db:sqlite/test:vitest`. Ele é composto unicamente por um vocabulário fechado de termos para linguagens, frameworks, bancos de dados e bibliotecas de testes — por construção, ele não contém nomes, caminhos, versões, contagens ou texto livre. Ele indica em quais stacks o Tendril é utilizado sem revelar de quem é o projeto.

#### Identidade do plano com sal de instalação (`plan_uuid`)

IDs brutos de planos continuam proibidos, mas os eventos ainda precisam ser agrupáveis por plano.
`telemetry::derive_plan_uuid` emite `SHA256("tendril-plan:" + anonymous_id + ":" + plan_id)` truncado para 16 bytes e formatado como um UUID RFC 9562 v8, em vez do próprio ID:

- o ID anônimo funciona como um sal exclusivo por instalação, portanto o plano `00042` deriva um valor diferente em cada instalação e não pode correlacionar usuários distintos
- o hash é unidirecional, então o contador sequencial nunca sai da máquina
- ele tem o escopo restrito a um único usuário anônimo, agrupando eventos sem expandir a identidade

Os IDs são normalizados para cinco dígitos primeiro, garantindo que o formato numérico do banco de dados (`42`) e o formato em pasta (`00042`) derivem o mesmo valor.

Qualquer necessidade futura de correlacionar um identificador proibido deve utilizar esse mesmo padrão de hash com sal, nunca o valor bruto.

### PROIBIDO — Informações Identificáveis

Nunca rastrear:

- **URLs**: URLs de repositórios, PRs ou issues
- **Caminhos**: caminhos de arquivos, diretórios ou caminhos absolutos para repositórios
- **Nomes de usuário**: nomes de usuário do GitHub, nomes de organizações, endereços de e-mail
- **Nomes de repositórios** e **nomes de projetos** — mesmo nomes genéricos revelam o contexto do trabalho
- **IDs sequenciais**: IDs de planos, números de issues, números de PRs (use hash por instalação — consulte `plan_uuid`)
- **Entrada do usuário**: descrições de tarefas, mensagens de commit, conteúdo de planos
- **Títulos**: títulos de planos, títulos de issues, assuntos de commits
- **Saída do agente**: transcrições, chamadas de ferramentas ou mensagens de erro que possam embutir conteúdo do usuário

## Estrutura de Decisão

1. Este campo pode identificar uma pessoa ou organização? &rarr; Proibido
2. Pode revelar informações privadas do repositório? &rarr; Proibido
3. Pode revelar no que o usuário está trabalhando? &rarr; Proibido
4. Pode ser correlacionado entre usuários para desanonimizá-los? &rarr; Proibido, a menos que utilize sal com o ID anônimo e hash unidirecional
5. Fornece insights agregados úteis? &rarr; Permitido

**Em caso de dúvida, deixe de fora.**

## Anexado a Cada Evento

Superpropriedades, definidas uma vez por processo em [client.rs](../../src/crates/tendril-core/src/telemetry/client.rs):

| Propriedade | Status | Notas |
|---|---|---|
| `$session_id` | Em conformidade | UUID aleatório, novo por processo |
| `$geoip_disable: false` | Aceito | O PostHog resolve o IP da solicitação para um país; o IP não é armazenado como propriedade do evento |
| `app_version` | Em conformidade | Versão da crate |
| `os` | Em conformidade | Nome da plataforma |
| `os_version` | Em conformidade | Release do `uname` no Unix, família de plataformas em outros ambientes |

O `distinct_id` (o ID anônimo) é anexado a todos os eventos. As propriedades `distribution` / `source` do aplicativo original foram omitidas: elas contêm um `AppBrand` do .NET sem equivalente na V2.

## Auditoria de Eventos Atuais

Todos os eventos estão em conformidade com esta política. Os contextos são structs tipadas em [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs), garantindo que a definição de propriedades seja uma decisão em tempo de compilação, e não um mapa dinâmico flexível.

| Evento | Propriedades | Emitido de |
|---|---|---|
| `app_started` | `version`, `project_count`, `llm_configured` | `run_server`, após a aquisição do lock principal |
| `job_created` | `job_type`, `agent`, `plan_uuid` | `JobManager::start_job_with` |
| `job_completed` | `job_type`, `status`, `duration_seconds`, `agent`, `plan_uuid` | `finish_job` |
| `plan_created` | `level`, `duration_seconds`, `agent`, `stack_hash`, `plan_uuid` | `finish_job`, `CreatePlan` com um entregável |
| `pr_created` | `duration_seconds`, `agent`, `plan_uuid` | `finish_job`, `CreatePr` |
| `plan_state_transition` | `from_state`, `to_state`, `plan_uuid` | `apply_plan_state`, assim que a escrita atingir o disco |

O `plan_uuid` é sempre o valor derivado com o sal de instalação: os pontos de chamada passam o ID bruto do plano para o contexto tipado e o cliente aplica o hash antes da captura, impedindo que o ID bruto chegue ao PostHog mesmo a partir de uma chamada desatenta à regra.

### Definido, mas não conectado

`onboarding_completed` e `project_created` têm structs de contexto em [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs) sem pontos de chamada: a V2 não possui um fluxo de integração (onboarding) e a criação de projetos ocorre no processo de CLI, onde nenhum cliente é instalado. Eles existem para que um plano futuro adicione o ponto de invocação em vez de alterar o esquema.

O cliente reside apenas no processo daemon. Uma invocação da CLI nunca executa `telemetry::install`, portanto `tendril plan ...` não transmite dados.

## Implementação

- [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs) — contextos tipados que aplicam esta política em tempo de compilação. Novos eventos recebem uma struct aqui, não uma coleção genérica de propriedades.
- [client.rs](../../src/crates/tendril-core/src/telemetry/client.rs) — cliente PostHog, ID anônimo, derivação do UUID de plano. Cada método `track_*` trata seus próprios erros e apenas envia itens para uma fila consumida por uma tarefa em segundo plano: a telemetria nunca deve falhar nem lentificar um trabalho.
- [telemetry_test.rs](../../src/crates/tendril-core/tests/telemetry_test.rs) — assegura zero chamadas de rede quando desativada, o conjunto exato de propriedades de cada evento conectado e a correta derivação do UUID do plano.
