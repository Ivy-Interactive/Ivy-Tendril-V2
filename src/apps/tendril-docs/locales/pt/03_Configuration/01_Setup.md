---
title: Instalação e Configurações
description: Configure o Tendril na interface de Configurações do aplicativo ou
  editando TENDRIL_HOME/config.yaml (projetos, agentes, níveis, verificações,
  preferências).
icon: Construction
searchHints:
  - config
  - yaml
  - configuração
  - configurações
  - projetos
  - gui
  - implantação
  - docker
  - segredos
  - BasicAuth
  - senha
  - hospedado
---

# Instalação e Configurações

## Configurações no aplicativo

O Tendril inclui um aplicativo dedicado de Configurações para configurar o ambiente visualmente, sem a necessidade de editar manualmente arquivos [YAML](https://yaml.org). A barra lateral de configurações oferece as seguintes seções:

- **Coding Agent** — Escolha o runtime do agente de codificação principal ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), Antigravity, [OpenCode](../06_CodingAgents/04_OpenCode.md), Cursor, Apple ou proxies personalizados compatíveis com a OpenAI), configure chaves de API de provedores e URLs base personalizadas, personalize perfis de agentes e níveis de raciocínio, teste a conectividade dos agentes e navegue pelas especificações dos modelos no Catálogo de Modelos. Para instalação e configuração de agentes, consulte [Coding Agents](../06_CodingAgents/_Index.md).
- **Plans** — Edite o modelo padrão de plano em Markdown (`planTemplate`) usado sempre que um novo plano for criado em [Plans](../04_Apps/03_Plans.md).
- **Appearance** — Selecione o modo de tema (**Light**, **Dark** ou **System**), escolha entre predefinições de tema integradas com amostras de pré-visualização, configure o estado padrão da barra lateral (expandida ou recolhida) e defina o destino do botão de Chat (**Chat view** ou **Terminal**).
- **Projects** — Gerencie projetos registrados, configure repositórios por projeto, verificações, portas, variáveis de ambiente, habilidades personalizadas, servidores [MCP](../09_Advanced/03_MCP.md) e acesse a Danger Zone. Consulte [Configuração de Projetos](02_Projects.md).
- **Team Vault** _(Beta)_ — Sincronize projetos, habilidades personalizadas, servidores MCP e regras de segurança entre os membros da equipe por meio de um repositório [Git](https://git-scm.com) compartilhado.
- **Workflow Agents** — Configure perfis de agentes [Promptware](../02_Concepts/02_Promptwares.md) e permissões granulares de ferramentas (`allowedTools`, `deniedTools`) em fluxos de trabalho padrão (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.) ou globalmente usando a chave `_default`.
- **Levels** — Defina níveis de complexidade (como L1, L2, L3) com pesos de execução relativos, descrições e cores personalizadas de distintivos.
- **Notifications** — Ative ou desative as notificações de sistema no desktop para conclusões e falhas de tarefas.
- **Security & Tunneling** — Configure proteção por senha de sessões web, inicie ou pare túneis [Cloudflare](https://www.cloudflare.com) com acesso total para acesso remoto e crie túneis de compartilhamento somente leitura com tokens de capacidade.
- **Advanced** — Defina limites de tempo de execução (`jobTimeout`, `staleOutputTimeout`), configure `maxConcurrentJobs`, alterne o acesso a recursos beta e inspecione diagnósticos em tempo real em **Daemon Diagnostics** (estado da conexão, PID, ping de latência, caminho `$TENDRIL_HOME` e capacidades reportadas).
- **Newsletter** — Inscreva-se para receber atualizações de produtos e notas de versão do Ivy & Tendril.
- **Open config.yaml** — Abra o editor integrado de YAML bruto com destaque de sintaxe em tempo real e links diretos para planos.

## `config.yaml`

As configurações modificadas na interface são persistidas imediatamente em `$TENDRIL_HOME/config.yaml` (o padrão é `~/.tendril/config.yaml`). Você também pode editar esse arquivo diretamente ou especificar um caminho personalizado usando a variável de ambiente `TENDRIL_CONFIG`.

> [!NOTE]
> O arquivo de configuração deve ser sempre chamado `config.yaml`. O daemon do Tendril recarrega automaticamente as alterações de configuração quando atualizado em disco.

### Exemplo

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Global Engine
    color: Emerald
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: CheckResult
        required: true

auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Managed via Settings
  hashSecret: "base64-secret-pepper"

api:
  apiKey: "your-api-secret-key"
```

### Campos comuns

| Campo                  | Tipo          | Padrão      | Finalidade                                                                                               |
| ---------------------- | ------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `codingAgent`          | string        | `"claude"`  | Executável padrão do agente de codificação. Consulte [Coding Agents](../06_CodingAgents/_Index.md).      |
| `maxConcurrentJobs`    | integer       | `20`        | Número máximo de execuções concorrentes de agentes em [Jobs](../04_Apps/04_Jobs.md) (worktrees).         |
| `jobTimeout`           | integer (min) | `30`        | Tempo limite de execução em minutos antes que uma tarefa ativa seja cancelada.                           |
| `staleOutputTimeout`   | integer (min) | `10`        | Tempo limite em minutos caso o processo de um agente não produza saídas em stdout/stderr.                |
| `daemonRequestTimeout` | integer (sec) | `30`        | Tempo limite de requisições do cliente em segundos ao se comunicar com o daemon local.                   |
| `planTemplate`         | string        | `""`        | Modelo em Markdown usado ao criar novos planos em [Plans](../04_Apps/03_Plans.md).                       |
| `theme`                | string        | `"default"` | Identificador de predefinição de aparência (ex.: `default`, `dracula`).                                  |
| `themeMode`            | string        | `"system"`  | Modo de tema: `light`, `dark` ou `system`.                                                               |
| `chatMode`             | string        | `"chat"`    | O que o botão de Chat abre: `chat` (visualização de Chat) ou `terminal` (terminal do agente).            |
| `desktopNotifications` | boolean       | `true`      | Se notificações de SO no desktop estão ativadas para eventos de tarefas.                                 |
| `projects`             | list          | `[]`        | Lista de projetos registrados e suas configurações. Consulte [Configuração de Projetos](02_Projects.md). |
| `levels`               | list          | standard    | Níveis e pesos de complexidade de planos configurados.                                                   |
| `auth`                 | object        | `null`      | Configuração de proteção de sessão por senha usando [Argon2](https://en.wikipedia.org/wiki/Argon2).      |
| `api.apiKey`           | string        | `null`      | Segredo compartilhado que protege endpoints da API REST. Consulte [API REST](../09_Advanced/02_REST.md). |
| `telemetry`            | boolean       | `null`      | Opção de envio anônimo de telemetria de uso (`false` ou ausente significa desativado).                   |

## Autenticação e Acesso Remoto

### Proteção de Sessão (Interface Web)

Ao hospedar o Tendril em um servidor remoto ou expô-lo através de uma rede, ative a proteção de sessão em **Settings > Security & Tunneling** ou configure credenciais por meio de variáveis de ambiente:

- `TENDRIL_AUTH_USERNAME` — Nome de usuário para login (padrão: `admin`).
- `TENDRIL_AUTH_PASSWORD` — Senha em texto simples a ser gerada como hash na inicialização.
- `TENDRIL_AUTH_HASH_SECRET` — String de 32 bytes em base64 (`openssl rand -base64 32` via [OpenSSL](https://www.openssl.org)) usada como o segredo pepper do [Argon2](https://en.wikipedia.org/wiki/Argon2).

No `config.yaml`, as senhas são armazenadas como hashes PHC Argon2 sob o bloco `auth:` com limitação de taxa opcional:

```yaml
auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..."
  hashSecret: "base64-encoded-pepper"
  rateLimit:
    threshold: 3
    baseDelaySeconds: 1.0
    maxDelaySeconds: 60.0
```

### Túneis Cloudflare

O Tendril se integra com túneis do [Cloudflare](https://www.cloudflare.com) (`cloudflared`) para expor o aplicativo com segurança sem portas de firewall de entrada abertas:

- **Full-Access Tunnel**: Publica o daemon completo do Tendril. Por segurança, o Tendril exige que a Proteção de Sessão esteja ativa com uma senha configurada antes de iniciar um túnel de acesso total.
- **Share Tunnel**: Cria um túnel somente leitura protegido por tokens de capacidade, permitindo o compartilhamento seguro do [Dashboard](../04_Apps/01_Dashboard.md) e do progresso dos planos com partes interessadas sem expor permissões de escrita.

### Proteção da API REST

A API REST utiliza autenticação por token por meio da configuração `api.apiKey` no `config.yaml` ou da variável de ambiente `TENDRIL_API_KEY`. Quando definida, as requisições devem fornecer o cabeçalho `X-Api-Key`. Consulte [API REST](../09_Advanced/02_REST.md) e [Configuração da CLI](../09_Advanced/01_CLI/06_Config.md).

## Verificações

O Tendril inclui definições de portões de verificação integrados que os projetos podem conectar aos seus pipelines:

| Verificação   | Descrição                                                                     |
| ------------- | ----------------------------------------------------------------------------- |
| `Build`       | Executa o comando de build do projeto e verifica zero erros de compilação.    |
| `Format`      | Verifica regras de formatação de código ou formata arquivos modificados.      |
| `Test`        | Executa testes unitários ou de integração com escopo nas alterações do plano. |
| `Lint`        | Executa análises estáticas / linters e relata quaisquer violações.            |
| `Screenshots` | Captura capturas de tela da interface no diretório de artefatos do plano.     |
| `CheckResult` | Verifica se a implementação final corresponde à especificação do plano.       |

Comandos personalizados de verificação (como `cargo test`, `pnpm test` ou `pytest`) podem ser definidos globalmente no `config.yaml` ou diretamente em [Configuração de Projetos](02_Projects.md#verification-pipelines). Para comandos de verificação via CLI, consulte [Verificação via CLI](../09_Advanced/01_CLI/03_Verification.md).
