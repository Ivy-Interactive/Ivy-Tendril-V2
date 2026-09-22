---
title: Notas de Lançamento
description: Histórico de versões, novos recursos, melhorias e correções de bugs
  para cada versão do Tendril.
icon: ScrollText
searchHints:
  - notas de lançamento
  - changelog
  - histórico de versões
  - atualizações
  - novidades
---

# Notas de Lançamento

## 2.0.0 (2026-09-21)

O Tendril v2 é uma reformulação arquitetural geracional da plataforma Tendril, reescrevendo o daemon e o mecanismo central de execução em [Rust](https://www.rust-lang.org), adotando o [Tauri v2](https://tauri.app) para o aplicativo desktop, introduzindo um frontend de alto desempenho em [Vite+](https://viteplus.dev) e adicionando concorrência nativa de worktrees multiagente, interações de terminal em tempo real e [provedores de modelos](../08_ModelProviders/_Index.md) expandidos.

### Principais Mudanças de Arquitetura

- **Daemon em Rust de Alto Desempenho (`tendril-server` e `tendril-core`)**: Substituição do backend .NET legado por um daemon assíncrono em [Rust](https://www.rust-lang.org) impulsionado por [Tokio](https://tokio.rs) e [Axum](https://github.com/tokio-rs/axum). O novo daemon oferece despacho de rotas em submilissegundos, pool de conexões robusto em [SQLite](https://www.sqlite.org) com timeouts de ocupação, gravações atômicas de arquivos de configuração e um protocolo de eleição de processo mestre único para IPC local com sobrecarga zero.
- **Aplicativo Desktop Tauri v2**: Transição da shell desktop para [Tauri v2](https://tauri.app), proporcionando uma distribuição desktop compacta e eficiente no uso de memória no macOS, Linux e Windows. Aproveita webviews nativas do sistema, ponte IPC reforçada, decoração de janela nativa e integração com a bandeja do sistema (system tray), eliminando dependências legadas de frameworks de tempo de execução.
- **Frontend React com Vite+**: Reconstrução da interface de usuário desktop do zero utilizando [Vite+](https://viteplus.dev) e [React 19](https://react.dev). Compartilha tokens de design atômico e componentes de renderização com `@ivy-interactive/components`, suportando hot reloading instantâneo, predefinições de temas unificadas (Default, Dracula, Forest, Lovably) e layouts responsivos para múltiplos breakpoints.
- **Execução Paralela de Worktrees**: Provisionamento automatizado de [git worktree](https://git-scm.com/docs/git-worktree) multirrepositório para execução concorrente de [planos](../02_Concepts/01_Plans.md). Múltiplos [agentes de código](../06_CodingAgents/_Index.md) podem executar planos separados simultaneamente em branches isoladas sem bloqueio de índice do git, colisões de repositório ou efeitos colaterais de troca de branch. Inclui um serviço de expurgo em segundo plano (`worktreeReaperInterval` e `worktreeReaperGrace`) para podar automaticamente worktrees ociosas ou órfãs.
- **Terminal em Tempo Real e Chats Interativos**: Introdução de emulação de terminal [PTY](https://en.wikipedia.org/wiki/Pseudoterminal) integrada alimentada por [Xterm.js](https://xtermjs.org) diretamente na shell do aplicativo. Os operadores podem alternar entre chat estruturado e interação bruta via terminal (`chatMode: terminal` ou `chatMode: chat`), interagir com agentes em execução via stdin, inspecionar execuções de ferramentas transmitidas em tempo real e manter prompts em fila persistentes durante alternâncias de sessão.
- **Integrações de Modelos Expandidas e Sidecars Integrados**:
  - **Sidecar OpenCode Integrado**: Distribui o binário da CLI do [OpenCode](https://opencode.ai) diretamente com o instalador desktop (`binaries/opencode`), permitindo a execução de [agentes OpenCode](../06_CodingAgents/04_OpenCode.md) sem configuração prévia e acesso imediato a centenas de modelos proprietários e de código aberto sem exigir instalações separadas de Node ou CLI.
  - **Traga Seu Próprio LLM (BYO LLM)**: Cartões de integração e configurações de primeira classe para [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) e o provedor soberano europeu [Berget AI](../08_ModelProviders/01_Berget.md) (`https://api.berget.ai/v1`), com normalização automática de URL base e despacho de credenciais para as variáveis dos SDKs da OpenAI e da Anthropic.
  - **Integração com Apple Foundation Model**: Suporte nativo para modelos locais on-device da Apple via macOS `fm serve`, executando inferência localmente com custo zero de API em nuvem e privacidade offline completa.
  - **Enriquecimento Dinâmico do Catálogo de Modelos**: Integração da descoberta dinâmica de catálogo do [models.dev](https://models.dev) com cache offline no [SQLite](https://www.sqlite.org), detecção de desatualização e endpoints de sincronização manual (`POST /api/models/refresh`).
  - **Perfis de Modelos em Camadas**: Camadas de perfis de modelos declarativos (`deep`, `balanced`, `quick`) em todos os [agentes de código](../06_CodingAgents/_Index.md) suportados ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) e Apple), incluindo seletores de esforço de raciocínio configuráveis (`low`, `medium`, `high`, `max`).

### Recursos

- **Terminal PTY Integrado para Ações de Revisão e Agentes**: Execute ações de revisão e sessões interativas de agentes dentro de abas de terminal completas compatíveis com ANSI e rastreamento da árvore de processos em tempo real.
- **Gerenciamento de Git Worktree Multirrepositório**: Espaços de trabalho de planos isolados estruturados em `Worktrees/<owner>/<repo>` com rastreamento de branch, detecção de fork de branch base upstream e proteção segura para commits não enviados (unpushed).
- **Sincronização Centralizada de Cofre de Equipe (Team Vault)**: Conecte, importe e envie configurações de projeto, [servidores MCP](../09_Advanced/03_MCP.md) personalizados e [habilidades de agentes](../06_CodingAgents/00_Skills.md) para cofres remotos com suporte Git via [Team Vault](../09_Advanced/01_CLI/07_Vault.md) com sanitização automatizada de credenciais.
- **Túneis Rápidos da Cloudflare**: Compartilhe revisões de planos em modo somente leitura e status de verificação em tempo real através de túneis seguros da [Cloudflare](https://www.cloudflare.com) com códigos QR, proteção de sessão por senha com [Argon2](https://en.wikipedia.org/wiki/Argon2) e personas de revisores anônimos.
- **Editor de Configuração no Aplicativo**: Editor completo no aplicativo com realce de sintaxe para `config.yaml`, detecção de conflitos em tempo real, ganchos de recarregamento e ações de prompt orientadas por assistente (consulte [Configuração](../03_Configuration/01_Setup.md)).

### Melhorias

- **Invocações de CLI em Submilissegundos**: A CLI `tendril` foi reescrita em Rust (`src/crates/tendril-cli`), alcançando inicialização de comandos quase instantânea e proxying transparente para o daemon (consulte [Visão Geral da CLI](../09_Advanced/01_CLI/00_Overview.md)).
- **Livro-Razão de Tokens e Custos**: Planilhas de detalhamento de tokens por tarefa em tempo real e rastreamento de custos calibrado em todos os principais modelos de provedores, com precificação de fallback automatizada para endpoints personalizados.
- **Solucionadores Automatizados de Verificação**: Executor de verificação estruturado que executa suítes de checagem de projeto (build, test, format, lint) com saída transmitida em tempo real e diagnósticos automáticos de falhas (consulte [Verificações](../09_Advanced/01_CLI/03_Verification.md)).
- **Renderizador Markdown Unificado**: Mecanismo de renderização de markdown compartilhado entre planos, notas e documentação, com suporte a tabelas GFM, blocos de código com realce de sintaxe, diagramas [Mermaid](https://github.com/mermaid-js/mermaid) e comentários de diff inline ancorados por caracteres no [Aplicativo de Revisão](../04_Apps/02_Review.md).

## 1.2.0 (2026-09-01)

### Recursos

- **Shell do Aplicativo Redesenhada (Figma)** — Layout da shell desktop modernizado com seções de navegação recolhíveis, abas de sessão persistentes e indicadores integrados de status do projeto (`#2173`).
- **Dashboard do Tendril Redesenhado** — Construído o novo widget React `TendrilDashboard` com contadores de status em tempo real, tendências de atividade, rastreamento de tarefas ativas e exibição de código QR para o Cloudflare Quick Tunnel (`#2201`).
- **Unificação de Rascunhos para Planos** — O aplicativo Drafts, serviços e modelos foram renomeados para "Plans" em toda a base de código, estabelecendo um ciclo de vida coeso desde a triagem de problemas até a execução verificada (`#2258`).
- **Uploads HTTP Multipart para Anexos de Chat** — Substituída a transmissão inline em base64 por uploads HTTP multipart fragmentados, evitando limites de payload do SignalR em imagens e arquivos grandes (`#2255`, `#2224`).
- **Mensagens em Fila Persistentes no Chat** — Mensagens em fila persistem e continuam visíveis ao alternar sessões de chat, permitindo que desenvolvedores enfileirem prompts enquanto um agente está ativamente em execução (`#2253`).
- **Atalho de Busca na Página (Ctrl+F / Cmd+F)** — Adicionada busca na página dentro de visualizações de markdown e planos sem interromper o fluxo do layout (`#2254`).
- **Pré-visualização em Tempo Real de Ações de Revisão** — Adicionadas capacidades de pré-visualização e execução de ações de revisão diretamente nas Configurações do Projeto (`#2225`).
- **Predefinição de Tema Lovably** — Adicionada uma predefinição de tema de interface moderna baseada nos tokens de design e escalas de cores do Lovable (`#2256`).
- **Expansão de CodeInput Monoespaçado** — Integração do `CodeInput` com realce de sintaxe em comandos e condições de Ações de Revisão (`#2247`), variáveis de ambiente MCP (`#2248`), prompts de Verificação (`#2249`) e conteúdo markdown de Memória do Projeto (`#2259`).
- **Diretrizes de Segurança no Chat** — Proibição de edições diretas e não verificadas na base de código durante sessões exploratórias de chat, exigindo a criação formal de planos para alterações (`#2221`).
- **Mesclagem de Projetos do Team Vault em Conflitos** — Adicionada resolução inteligente de mesclagem ao importar projetos de cofre que compartilham nomes com projetos locais (`#2219`).

### Melhorias

- **Prompts de Chat de Agente e Geração de Issues Enriquecidos** — Fornecimento de contexto completo do projeto, mapeamentos de repositório e metadados de anexos para os prompts iniciais de chat de agentes e criação de issues no GitHub (`#2226`).
- **Indicadores de Modo de Tema nas Configurações de Aparência** — Exibição clara dos estados ativos de modo claro/escuro nas configurações de Aparência (`#2213`).
- **Widget ContentInput Responsivo a Temas** — Adaptação dinâmica de barras de entrada, botões e bordas entre predefinições de temas personalizados (`#2241`).
- **Simplificação da Tabela de Ações de Revisão** — Tabela de configuração de Ações de Revisão simplificada nas Configurações do Projeto para melhor legibilidade (`#2240`).
- **Builds a partir do Código-Fonte em Contêineres de Staging** — Imagens Docker de staging configuradas para compilar diretamente a partir do código-fonte para testes precisos de branches de pré-visualização de PR (`#2229`).
- **Aprimoramento de Layout e Espaçamento da Barra Lateral** — Refinamento do espaçamento de badges de marcação concluída e layouts de sessões em geração na barra lateral do Chat (`#2220`, `#2223`).
- **Diálogo Nativo para Exclusão de Sessão** — Substituído o popup modal do React por um widget nativo `DeleteSessionDialog` para exclusão de sessões (`#2222`).

### Correções de Bugs

- **Visibilidade de Tarefas e Reidratação da Fila** — Correção de cartões de tarefas ausentes e restauração correta de estados de tarefas ativas na fila após reinicializações do aplicativo (`#2243`).
- **Limpeza de Tarefas Bloqueadas Fantasmas** — Prevenção de tarefas bloqueadas órfãs ou substituídas de persistirem no armazenamento SQLite e nas visualizações de Saída (`#2250`).
- **Timeouts no Chat do Agente Antigravity** — Sessões de agentes Antigravity configuradas para respeitar os padrões globais de timeout configurados, em vez de atingir o tempo limite prematuramente (`#2218`).
- **Alvo de Edição de Verificação nas Configurações do Projeto** — Correção do diálogo de verificação apontando para a entrada incorreta de verificação durante edições (`#2252`).
- **Transbordamento de Bloco de Código Markdown** — Prevenção de trechos largos de código de transbordarem horizontalmente os contêineres de planos pai (`#2214`).
- **Contraste dos Temas Escuros Dracula e Forest** — Resolução de bugs de visibilidade ao passar o mouse em textos e ícones em itens da barra lateral, ícones de configurações e abas em temas escuros (`#2210`, `#2211`, `#2212`, `#2239`, `#2242`).
- **Eliminação de Barra Lateral Duplicada** — Eliminação da renderização redundante da barra lateral durante transições da shell do aplicativo (`#2244`).
- **Estado de Rascunho Concluído em Issues Resolvidas** — Resolução de estado não completável ao gerar planos para issues resolvidas anteriormente (`#2217`).
- **Limpeza de Modelos Descontinuados** — Remoção de referências descontinuadas ao modelo Gemini 3.5 Flash em favor do Gemini 3.7 Flash (`#2215`).
- **Limpeza de Artefatos Efêmeros de Teste** — Garantia de que execuções de testes de ponta a ponta limpem diretórios temporários e arquivos de rascunho de agentes (`#2209`).

## 1.1.36 (2026-08-28)

### Recursos

- **Teste de Modelo e Verificação de Autenticação em Tempo Real no Onboarding** — O onboarding agora testa ativamente as credenciais de endpoints e modelos de perfil (`Deep`, `Balanced`, `Quick`) com requisições de prompt em tempo real antes de permitir a navegação, bloqueando nomes de modelos inválidos e desempacotando payloads de erros de proxy aninhados em mensagens claras.
- **Constantes de Prioridade de Perfil de Modelo e Enums de Provedores** — Substituição de cascatas ternárias por tabelas declarativas de prioridades (`ModelProfilePriorities`) e enums (`ModelProviderKind`, `ModelProfileKind`) para resolução consistente de modelos padrão e candidatos no onboarding e nas configurações.
- **Fallback de Implantação de Promptware Sob Demanda** — Adicionada implantação de fallback automática no `PromptwareRunner` e `PromptwareRunCommand` para extrair promptwares ausentes de recursos incorporados sob demanda caso o `Program.md` esteja ausente.

### Melhorias

- **Prioridade para Binário do Agente Ivy Integrado** — Imposição da resolução de binários do `ivy-agent` integrados ou gerenciados pelo Tendril (`~/.tendril/bin`), evitando que executáveis não gerenciados do `PATH` do sistema interfiram na execução do agente.
- **Persistência de Entrada de Modelo Personalizado nas Configurações** — Correção de entradas de nomes de modelos personalizados que revertiam ao pressionar Enter ou em nova renderização no `CodingAgentSetupView`.
- **Remoção do Recurso de Lixeira** — Remoção do aplicativo e conjunto de comandos obsoletos de Lixeira (Trash), substituindo marcadores de lixeira por tratamento limpo de rejeição de duplicatas no `CreatePlan`.

## 1.1.35 (2026-08-28)

### Recursos

- **Túnel de Modo de Compartilhamento e Compartilhamento Externo `[Beta]`** — Compartilhe links de planos e rascunhos de forma segura externamente por túneis Cloudflare com geração automática de URL de compartilhamento e ações de cópia, protegido sob a flag beta (`beta: true` nas configurações ou `TENDRIL_BETA`).
- **Proteção de Sessão para Modo Compartilhado** — Adicionada proteção de sessão por senha com hash Argon2 nas Configurações sob uma seção unificada de "Segurança e Tunelamento".
- **Personas de Revisores Anônimos** — Geração de personas anônimas amigáveis com avatares de iniciais para colaboradores externos que revisam planos compartilhados.
- **Comentários Inline em Diffs de Rascunhos e Planos** — Adicionados comentários inline de revisores em tempo real em blocos de diff no modo de Revisão (`DraftDiffCommentService`) com uma ação dedicada de "Solicitar Alterações" e contadores em badges.
- **Anotações de Seleção de Texto em Rascunhos** — Adicionado destaque em seleções de texto e popovers ancorados a deslocamentos de caracteres em `DraftMarkdown` (`DraftAnnotationService`).
- **Cofre de Configuração de Equipe `[Beta]`** — Introduzida a sincronização centralizada de configurações de equipe com suporte a repositórios Git (`VaultService`, acessível sob a flag beta), permitindo que equipes criem, conectem, importem e enviem configurações de projeto para cofres remotos com sanitização automatizada de segredos (`VaultSecretSanitizer`).

### Melhorias

- **Proveniência de Tarefas e Registro de Perfil** — Registro de perfis de execução por tarefa e proveniência estruturada de planilhas de custo como fatos.
- **Isolamento de Recursos Beta** — Garantia de que botões de compartilhamento, controles de túnel e configurações de cofre fiquem claramente isolados sob flags beta tanto na interface quanto nas camadas de comando.

### Correções de Bugs

- **Empacotamento Desktop para Windows** — Correção de falha de empacotamento através do uso de extração de zip com junk-path para o `ivy-agent.exe` integrado em compilações Windows x64 e arm64.

## 1.1.34 (2026-08-25)

### Recursos

- **Terminal PTY Integrado para Ações de Revisão** — As ações de revisão agora são executadas em uma aba de terminal integrada e responsiva alimentada por Xterm (`ReviewActionApp`) em vez de abrir janelas externas de terminal.
- **CLI do Agente Ivy Integrada** — O executável independente do `ivy-agent` foi integrado diretamente ao instalador do aplicativo Tendril, eliminando requisitos de instalação manual.
- **Traga Seu Próprio LLM (BYO LLM) e Catálogos de Modelos** — Adicionados catálogos de provedores e seletores de modelos para configurações de BYO LLM e Ivy Proxy no onboarding e nas configurações, com suporte para Gemini 3.7 Flash, modelos Claude e modelos de raciocínio da OpenAI.
- **Seleção de Esforço de Raciocínio de Modelos** — Introduzidos seletores de nível de esforço (low, medium, high) para modelos de raciocínio suportados nas configurações de perfil de agentes de código.
- **Servidores MCP Personalizados e Habilidades de Agentes** — Adicionado suporte para importação de servidores MCP e habilidades personalizadas diretamente de repositórios Git, URLs remotas e caminhos de arquivos locais, completo com interface de gerenciamento e validação.
- **Planilha de Detalhamento de Tokens e Custos** — Introduzidas planilhas interativas de uso de tokens e detalhamento de custos acessíveis diretamente das células de custo de tarefas na tabela de Tarefas.
- **Organização de Worktrees Multirrepositório** — Worktrees de planos estruturadas sob caminhos `Worktrees/<owner>/<repo>` para suportar configurações multirrepositório e layouts complexos de projetos.
- **Navegação por Teclado e Gerenciamento de Abas** — Adicionado suporte ao atalho `Cmd+W` / `Ctrl+W` para fechar abas ativas no Tendril autônomo e refinados os indicadores de atalho Command (`⌘`) no macOS em todos os diálogos.

### Melhorias

- **Otimização de Desempenho em Rascunhos e Revisões** — Redução drástica da latência de troca de plano e da sobrecarga de troca de abas nos aplicativos de Revisão e Rascunhos.
- **Escalabilidade do DataTable de Tarefas** — Renderização e sincronização de dados do DataTable otimizadas para lidar perfeitamente com mais de 100 tarefas ativas e históricas sem engasgos na interface.
- **Fila de Chat e Indicadores de Status** — Painel de mensagens em fila do Chat redesenhado com controles inline, além de badges de status de geração em tempo real na barra lateral.
- **Ancoragem de Anotações em Rascunhos** — Popovers de seleção e destaques da barra de ferramentas ancorados aos deslocamentos de caracteres de texto no DraftMarkdown para evitar desvios durante a rolagem.
- **Exibição da Branch Base da Worktree** — Exibição dos pontos de bifurcação (fork) da branch base upstream na aba Git de Revisão e adicionado rastreamento de branches na visão geral de Pull Requests.
- **Supressão de Notificações Toast no Desktop** — Supressão de alertas toast redundantes no aplicativo quando notificações nativas da área de trabalho do sistema operacional são exibidas.
- **Redesenho da Interface de Configurações** — Layout das configurações do projeto refatorado com amostras de cores do projeto, cartões recolhíveis de MCP/habilidades personalizadas e padronização no tamanho dos botões.

### Correções de Bugs

- **Proteção contra Commits Não Enviados na Worktree** — Impedido que o expurgador de worktrees torne órfãos ou exclua commits não enviados de planos durante a limpeza em segundo plano.
- **Fixação do Cabeçalho de Chamadas de Ferramenta** — Garantido que os títulos de chamadas de ferramentas de agentes fiquem fixos no topo da viewport durante saídas longas em streaming.
- **Falsa Falha de Tarefa em Erros de Ferramenta Recuperados** — Evitado que tarefas do Antigravity falhem incorretamente quando o agente se recupera com sucesso após um erro inicial de ferramenta.
- **Insensibilidade a Maiúsculas e Minúsculas em URLs de PR do GitHub** — Suporte a URLs de repositório sem distinção entre maiúsculas e minúsculas (`Https://`, `Git@`, etc.) durante operações de importação e PR do GitHub.
- **Preservação de Spans no Formatador de Links Markdown** — Correção da substituição de links de planos no formatador de markdown para não corromper spans de planos aninhados.
- **Estabilidade do Fluxo de Onboarding** — Correção de travamento no onboarding quando a instalação de um agente falha ou quando binários necessários estão temporariamente ausentes.

## 1.1.19 (2026-07-28)

### Recursos

- **Suporte ao Claude Opus 5** — Adicionado suporte ao modelo `Claude Opus 5` (`claude-opus-5`) no catálogo Claude com metadados de preços atualizados.
- **Cancelamento em Massa de Tarefas** — Introduzidas ações de cabeçalho "Parar Todas as Tarefas" e "Parar Todas as Enfileiradas" no `JobsApp` (`IJobService.StopAllJobs` e `StopQueuedJobs`) para gerenciamento de tarefas em massa.
- **Poda de Memória de Promptware** — Adicionado comando CLI `promptware delete-memory` e capacidade de firmware, permitindo que promptwares excluam arquivos de memória obsoletos.
- **Resolução de Referências de Memória** — Resolução automática de referências de memória no comando CLI `read-memory`, em vez de gerar erros quando notas referenciadas são solicitadas.
- **URL de Agente Ollama Configurável** — Adicionada opção de URL base configurável (`--url`) para endpoints locais de agentes Ollama.
- **Capacidade de Importação de Issues** — Limite do diálogo de Importar Issues expandido de 100 para 1.000 issues, com avisos de truncamento ao atingir o teto.
- **Persistência de Estado de Tarefas em Execução** — Tarefas ativas em execução persistidas no banco de dados SQLite para que as atualizações de status sobrevivam a reinicializações do processo mestre.
- **Configuração Automática de PATH da CLI no Windows** — Criação automática de wrappers `tendril.cmd` e registro do diretório do aplicativo no PATH do Usuário do Windows na inicialização do aplicativo e nos ganchos do instalador Velopack.

### Melhorias

- **Coalescência de Atualização Automática de Túnel** — Coalescência de atualizações automáticas intensas da caixa de entrada e atualizações de células do `JobsApp` condicionadas a alterações de dados, interrompendo atualizações excessivas em conexões de túnel Cloudflare.
- **Otimização de Leitura Sequencial de Agentes** — Redução da sobrecarga de inicialização de processos durante leituras sequenciais de arquivos por agentes de código.
- **Moeda no Gráfico de Custos do Dashboard** — Indicadores de moeda ($) adicionados às séries de barras do gráfico de custos no dashboard.
- **Formatação da Tabela de Tarefas** — Links em markdown e formatações achatados na coluna de prompt/título da tabela de Tarefas para uma visualização tabular mais limpa.
- **Saída de CLI Redirecionada e Suporte a JSON** — Fallbacks ASCII para renderização de tabelas de CLI redirecionadas via pipe e adicionada a flag de saída `--json` para `tendril verification list`.
- **Redirecionamento de Ferramentas .NET Legadas** — Adicionadas verificações de integridade (doctor) e redirecionamento automático para rotear invocações de ferramentas `.NET` legadas (`ivy-tendril`) para a CLI do Tendril instalada.
- **Redesenho da Documentação** — `README.md` redesenhado seguindo o layout Orca com GIFs de funcionalidades atualizados.

### Correções de Bugs

- **Validação de Nome de Projeto** — Validação estrita de nome de projeto na CLI, diálogo de Configurações e fluxo de onboarding para rejeitar nomes inválidos e evitar falhas durante a configuração.
- **Sobrecarga de Inicialização da CLI** — Prevenção da inicialização do servidor Tendril quando `--help`, `-h` ou argumentos não reconhecidos são passados para `tendril`.
- **Relato de Status 404 de Tarefas** — Endpoints de `tendril job status` e `tendril job fail` tornados tolerantes a falhas (best-effort), em vez de lançar erros 404 fatais.
- **Aviso de Analisador Duplicado** — Removido PackageReference duplicado de `Ivy.Analyser` no `Ivy.Tendril.csproj`, eliminando avisos NU1504, e atualizado `UpdateIvyPackages.ps1` para editar versões in-place.
- **Execução de Shell no PlatformHelper** — Definição explícita de `UseShellExecute` como `false` para comandos `open` (macOS) e `xdg-open` (Linux) no `PlatformHelper`.

## 1.1.16 (2026-07-24)

### Recursos

- **Integração com Ivy Agent** — Introduzida integração para o Ivy Agent independente, incluindo um instalador de CDN com um clique nas Configurações, configurações de URL de proxy Ivy personalizadas e isolamento por flag beta (`TENDRIL_BETA` ou `IVY_BETA`).
- **Seletores de Badges Compactos** — Substituídos os campos de seleção de projeto e prioridade de largura total no diálogo Criar Plano por botões de badge compactos e roláveis (widget `BadgeSelect`).

### Melhorias

- **Diagnósticos de DNS do Túnel Cloudflare** — Mensagens detalhadas de diagnóstico de inicialização e conexão exibidas para falhas no túnel `cloudflared`.
- **Limpeza na Visualização de Configurações** — Entradas de configurações refatoradas para usar propriedades nativas do builder `.Description(...)` em C# para consistência visual.

### Correções de Bugs

- **Sobreposição de Diálogo ao Adicionar Projeto** — O botão "Novo Projeto" em Criar Plano agora abre o diálogo Adicionar Projeto diretamente por cima, sem navegar para outra tela.
- **Análise de URL de Túnel** — Correção da extração de URL do túnel cloudflared ao ignorar referências de domínio internas a `api.trycloudflare.com`.

## 1.1.14 (2026-07-21)

### Recursos

- **Documentação de Avisos de Terceiros** — Adicionado `THIRD_PARTY_NOTICES.md` para documentar licenças de dependências de terceiros incluídas no pacote.

### Melhorias

- **Estado Otimista em ContentInput** — Implementadas atualizações otimistas de estado de texto local no widget `ContentInput`, adiando atualizações de propriedades em segundo plano durante a digitação para evitar sobrescritas no campo.

### Correções de Bugs

- **Downloader do Cloudflared** — Resolução de uma falha de configuração no instalador e downloader automático do binário `cloudflared`.
- **Análise de Falha do Codex** — Correção na análise de falhas do agente de código Codex e na validação do catálogo de modelos.
- **Layout de Configurações de Túnel** — Correção de erros tipográficos de strings e layout na tela de Configuração do Túnel.

## 1.1.13 (2026-07-20)

### Recursos

- **Implementação de Recomendações em Lote** — Selecione e implemente múltiplas recomendações de uma só vez no aplicativo de Revisão.
- **Investigar e Discutir com o Agente** — Adicionados botões de ação "Investigar com Agente" e "Discutir com Agente" em Rascunhos, Revisão e na planilha de Depuração de Tarefas.
- **Comando de CLI para Adicionar Worktree ao Plano** — Adicionado o comando CLI `tendril plan add-worktree` para gerenciamento simétrico de worktrees.
- **Reexecução de Tarefas RetryPlan Concluídas** — Capacidade de reexecutar tarefas `RetryPlan` concluídas diretamente da lista de Tarefas.

### Melhorias

- **Recarregamento Automático de Configuração** — Recarregamento automático da configuração mediante edições externas de arquivos.
- **Resumo de Revisão e Abas** — Resumo de Revisão renderizado como DraftMarkdown com cartão fixo de Verificações e abas de Revisão extraídas em visualizações dedicadas.
- **Consolidação de Logs de Tarefas** — Consolidação de todos os logs de execução de tarefas sob um diretório unificado `<TendrilHome>/Jobs/`.
- **Destaque em Itens da Barra Lateral e Linhas de Tabela** — Itens da lista da barra lateral e tabelas de dados aprimorados com estilo de seleção de fundo preenchido.
- **Atualização do Framework Desktop** — Atualizadas dependências do framework Ivy para 1.3.8 e configurados detalhes do diálogo Sobre no desktop.

### Correções de Bugs

- **Preservação de Estado na Exclusão de Tarefas** — Preservado o estado de planos concluídos ao excluir tarefas finalizadas.
- **Renderização de Markdown e Matemática** — Correção de cifrões em texto que eram renderizados como fórmulas matemáticas LaTeX e correção do estilo de código inline no DraftMarkdown.
- **Vazamento de Semáforo em Slots de Tarefas** — Correção de vazamento de semáforo na alocação de slots de tarefas durante falhas de inicialização não tratadas.
- **Travamento de Tarefas em Estado de Inicialização** — Correção de tarefas travando indefinidamente no estado inicial através da adição de tratamento de erros de lançamento.
- **Sincronização de Commits em Worktrees** — Garantido que commits de todas as worktrees de planos sejam sincronizados corretamente.

## 1.1.12 (2026-07-03)

### Melhorias

- **Solucionadores de Verificação Dotnet** — Atualizados os prompts de verificação `DotnetBuild`, `DotnetFormat`, `DotnetTest` e `FrameworkDotnetBuild` para localizar explicitamente o arquivo de solução. Adicionadas notas de escopo para configurações multirrepositório, garantindo compilações e testes confiáveis.
- **Layout da Interface de Pull Requests** — Colunas do aplicativo PullRequest reordenadas para exibir Plano primeiro e Repositório por último, com redução da largura das colunas Custo e Tokens para 80px para um layout de tabela mais compacto e legível.

### Correções de Bugs

- **Troca de Corpo em CreatePr Concorrente** — Correção de uma condição de corrida em que tarefas concorrentes de `CreatePr` poderiam trocar ou sobrescrever as descrições de pull requests umas das outras devido a arquivos de texto de corpo não exclusivos. Migrado para `mktemp` para criação de arquivos de corpo exclusivos e adicionados testes de regressão.
- **Corrida no Analisador de Eventos Compartilhado** — Resolução de condição de corrida na análise de eventos isolando analisadores por sessão, em vez de compartilhar instâncias. Adicionados testes de regressão para evitar futuras condições de corrida multissessão.

## 1.1.11 (2026-07-03)

### Correções de Bugs

- **Correção no Instalador e Inicialização no macOS** — Correção de um problema crítico em que o instalador do macOS (.pkg) concluía com sucesso, mas falhava ao instalar ou iniciar o aplicativo devido a symlinks quebrados e assinaturas codesign durante o reempacotamento. Substituído `pkgutil --expand-full` por `pkgutil --expand` para preservar a integridade do payload do app, corrigido o diretório de destino para `1.pkg/Scripts/postinstall` e corrigido um erro tipográfico de caminho no script de confiança de certificados localhost.

## 1.1.10 (2026-07-03)

### Correções de Bugs

- **Notarização do Instalador macOS** — Correção na notarização do instalador macOS com submissão e grampeamento (stapling) adequados do pacote do instalador reempacotado.

## 1.1.9 (2026-07-03)

### Recursos

- **Entrada de Arquivos em Promptware** — Adicionado suporte para entrada de conteúdo baseado em arquivos para comandos de escrita em promptware, permitindo que promptwares processem arquivos locais durante a execução.
- **CLI de Recuperação de Revisão de Plano** — Adicionado um novo comando CLI `plan get-revision` para recuperar e inspecionar revisões históricas de um plano.
- **Política de Alterações Não Rastreadas no SyncRepo** — Adicionadas opções configuráveis de política de alterações não rastreadas (Stash/Commit/PullRequest) para a execução do SyncRepo.
- **Graduação da CLI Antigravity** — Graduadas as integrações e verificações da CLI Antigravity para status totalmente estável.

### Melhorias

- **Relato Universal de Bugs** — Habilitado o envio de relatórios de bugs em todos os agentes, normalizando modelos de destino para famílias suportadas pelo backend e anexando metadados originais do agente, com correção do relato de bugs no macOS através da coleta recursiva de arquivos de planos e desconsideração prévia de pastas de worktree.
- **Fallbacks na CLI de Verificação** — Os comandos `verification` agora listam automaticamente todos os scripts de verificação disponíveis se o nome de verificação especificado não for encontrado.
- **Estilos do Widget DraftMarkdown** — Sincronização dos estilos do widget DraftMarkdown com as atualizações mais recentes do sistema de design principal.

## 1.1.8 (2026-07-03)

### Recursos

- **Capacidade de Autoatualização no Desktop** — Implementados capacidade e diálogo de autoatualização, permitindo que o aplicativo desktop verifique e se atualize para a versão mais recente automaticamente.
- **Persistência da Pasta Tools** — Preserva o diretório `Tools/` durante atualizações de promptware e garante que as pastas de tempo de execução do promptware estejam estruturadas corretamente.

### Melhorias

- **Atalho no Aplicativo de Rascunhos** — Adicionado o atalho de teclado `Backspace` para disparar a ação Excluir no aplicativo Drafts (resolvendo #1507).
- **Espaçamento de Layout Responsivo** — Botão de link da issue realinhado no cabeçalho responsivo para evitar sobreposições e quebras de linha no texto.

## 1.1.7 (2026-07-02)

### Recursos

- **Geração de Certificados HTTPS Localhost** — Geração e empacotamento automáticos de certificados SSL/TLS seguros para localhost em aplicativos desktop para macOS e Windows, habilitando HTTPS local pronto para uso.
- **Melhoria no Diálogo Criar Plano** — Adicionado um link de atalho direto para "Novo Projeto" no diálogo Criar Plano para um onboarding mais rápido.
- **Seleção do Claude Fable 5** — Adicionado `Claude Fable 5` como opção de modelo selecionável nas configurações de modelos.
- **Integração de CLI de Configuração e MCP** — Adicionados comandos de primeira classe `config get` e `config set` à CLI do Tendril e aos endpoints de servidor Model Context Protocol (MCP).
- **Experimento FieldToolsDemo** — Introduzido um novo experimento `FieldToolsDemo` para testes de desenvolvedores.

### Melhorias

- **Exclusão Otimista de Tarefas** — Exclusão de tarefas tornada otimista ao delegar tarefas de limpeza de git worktree para threads em segundo plano, proporcionando resposta mais rápida na interface.

### Correções de Bugs

- **Workflows de CI e Scripts** — Correção de erro de sintaxe YAML no fluxo de publicação, resolução de falhas na geração de certificados SSL em pipelines de CI e correção de erro de sintaxe no script de pós-instalação do macOS.

## 1.1.6 (2026-07-02)

### Recursos

- **Relato de falhas de primeira classe** — Adicionado o comando CLI `tendril job fail <job-id> --message`, permitindo que promptwares relatem falhas específicas de execução explicitamente em vez de depender de códigos de saída e heurísticas brutas de stdout.
- **Atualização automática da caixa de entrada** — Substituída a sondagem por intervalo nos aplicativos Drafts, Review, Icebox, Recommendations e Trash por atualizações baseadas em assinaturas utilizando um observador de sistema de arquivos e status de processo com debounce.
- **Consolidação do atualizador Velopack** — Fluxo de autoatualização desktop consolidado no Velopack, permitindo verificação de atualizações nas Configurações, persistência de atualizações dispensadas entre reinicializações e remoção do projeto obsoleto `Ivy.Tendril.Updater`.
- **Widget UserQuestion** — Adicionado um novo widget e visualizador `UserQuestion` para prompts interativos com o usuário.
- **Guia de onboarding** — Adicionado um guia de onboarding de primeira classe à documentação de Primeiros Passos.
- **Melhorias em novos planos** — Adicionado um botão seletor de projeto diretamente no diálogo Criar Plano, e renomeado `CustomPrDialog` para `CreatePrDialog`.

### Melhorias

- **Segurança de caminhos e shell no Windows** — Substituídos caracteres inseguros para shell (pipes e parênteses) na configuração de projeto `stackHash` por extensões `/` e `.ts`, e implementado escape de argumentos na CLI do Windows.
- **Acesso à rede em sandbox para agentes** — Habilitado acesso à rede em sandbox para o Codex através da configuração `sandbox_workspace_write.network_access`, corrigindo PermissionError em operações de bind de socket.
- **Suporte a Ollama local no OpenCode** — Ignoradas checagens de autenticação e resolvido o caminho do binário automaticamente ao executar o OpenCode com um modelo Ollama local, alternando para execução com `--auto` para evitar travamentos de PTY.
- **Tratamento de links markdown** — Centralizados os testes de segurança e polimento de renderização de links markdown de revisões de planos para remover âncoras de número de linha de URLs de arquivos.
- **Nome de usuário do GitHub no relatório de bugs** — Adicionado um campo opcional de nome de usuário do GitHub no diálogo de Relatório de Bugs e no comando CLI `report-bug`.
- **Refinamentos no layout da interface** — Ocultado o painel de QR do Túnel em telas de celular/tablet, aninhado o indicador de carregamento (spinner) dentro do callout inicial, corrigido o ícone do botão "Parar" e restaurado o espaçamento no layout de ações de Revisão.
- **Desdobramento de texto para Gemini** — Adicionado desdobramento de texto para a formatação de quebra de linha rígida do Gemini para melhorar a legibilidade.
- **Estilização de elementos de teclado** — Adicionada estilização para elementos `<kbd>` no widget de markdown.

### Correções de Bugs

- Correção de tarefas travando indefinidamente na janela de pré-lançamento devido a deadlocks ou saídas obsoletas, ativando timeouts imediatamente e executando hooks prévios concorrentemente.
- Correção da posição de rolagem na tela Criar Plano resetando/oscilando para o topo ao navegar entre abas.
- Correção do cálculo de custo de tarefas com timeout, recorrendo a cálculos baseados em preços quando o custo inline for zero ou ausente.
- Correção de planos CreatePr permanecendo em Rascunhos quando os agentes pulam etapas de encerramento, analisando automaticamente URLs de PR a partir da saída ao concluir.
- Correção de excesso de logs de sessão na inicialização e formatação de travessão (em-dash) nos logs de eleição mestre.
- Correção de erros de escuta EPERM na inicialização ao vincular servidores de teste ao loopback.
- Correção da saída do agente Codex encolhendo para altura zero durante a execução.
- Correção de problemas de foco/desfoco de teclado e foco automático na entrada de texto quando o diálogo Novo Plano é aberto.
- Desativado o recurso não utilizado de Túnel na configuração padrão.

## 1.1.1 (2026-06-25)

### Recursos

- **Entrada rica e de voz para planos** — O novo widget ContentInput traz transcrição de voz e anexos de arquivos para o diálogo Criar Plano; os arquivos são enviados via HTTP POST e armazenados junto ao plano, com suporte a arrastar e soltar.
- **Chat com o Agente** — O AgentApp Beta permite conversar diretamente com o agente de código através de um PTY, com um botão "Conversar com o Agente" no diálogo Novo Plano e a CLI `tendril` exposta ao agente via shim.
- **Anotações de planos** — Anote rascunhos no DraftsApp para conduzir atualizações de planos baseadas em anotações.
- **Suporte a mobile e tablets** — O Tendril agora é responsivo em breakpoints de celular, tablet e desktop, com cabeçalhos, planilhas, seletores e visualizador de processos adaptáveis.
- **Widget DraftMarkdown** — Renderiza diagramas Mermaid e Graphviz, callouts, imagens locais e clicáveis, e anotações inline de texto.
- **Atualizações automáticas com Velopack** — O aplicativo desktop se atualiza automaticamente via Velopack, com prevenção de colisão de nomes no instalador.
- **Mapa de calor de atividades** — O aplicativo Wallpaper exibe um mapa de calor de atividades de PRs concluídos nos últimos 90 dias.
- **SyncRepo e verificação prévia de repositório modificado** — Novo promptware SyncRepo acrescido de uma verificação prévia que detecta e resolve estados sujos no repositório antes de Executar e Criar Plano.
- **Dependências de tarefas** — Bloqueio no nível de tarefas com `WaitForJobs` e falha em cascata, reavaliação periódica de tarefas bloqueadas e uma ação de Forçar Inicialização para tarefas bloqueadas.
- **Reexecução com feedback** — Reexecute uma tarefa com feedback adicional para o agente.
- **Reverter revisão** — Reverta uma revisão específica de plano diretamente da aba Detalhes.
- **Expurgador de worktrees obsoletas** — Limita o uso de disco de worktrees expurgando worktrees obsoletas deixadas por execuções anteriores.
- **IPC CLI/servidor baseado em HTTP** — A CLI e o servidor comunicam-se via HTTP com eleição de mestre para coordenação confiável de instância única.
- **Runtimes integrados** — SDK do .NET 10 e PowerShell 7 são incluídos nos instaladores e resolvidos dinamicamente em tempo de execução quando presentes.
- **Diretrizes de proteção para repositórios** — Planos são protegidos contra execução ou mesclagem em repositórios fora do seu projeto, e a branch padrão do repositório é detectada em vez de presumir `main`.
- **Framework de migração de planos** — Adicionado `schemaVersion` ao `plan.yaml` com um framework de migração de planos por arquivo.
- **Variáveis de ambiente de agentes de código** — Configure variáveis de ambiente por agente nas configurações de Agentes de Código.
- **Comando `tendril agent-instructions`** — Exiba as instruções do agente a partir da CLI.

### Melhorias

- **Polimento no Túnel** — Estado de conexão, código QR no wallpaper, Abrir no Navegador, detecção de roteável antes de conectado, limpeza de instâncias órfãs de `cloudflared` e desativação em um clique com interface otimista.
- **Verificações como fonte única da verdade** — O `plan.yaml` agora é a fonte da verdade para verificações, com um cartão de interface dedicado, enum de status e ordenação por arrastar e soltar no diálogo de edição do projeto.
- **Planilha de Depuração de Tarefas** — Adicionados diretório de trabalho e argumentos de CLI, botões de cópia para IDs de Plano/Tarefa, botão de Relatar Bug e aprendizados de promptware (gravações de memória/ferramentas); oculta linhas vazias e negações de permissão.
- **Renomeação de estados de planos** — `Building → Creating` e `ReadyForReview → Review` para nomenclatura mais clara do ciclo de vida.
- **Consolidação da CLI** — Registro em canal único, propagação unificada de exceções, saída descritiva de status de tarefas e adição de endpoints de Web API/MCP para paridade total com a CLI.
- **Recomendações simplificadas** — Removido o campo Risco das recomendações em toda a interface e prompts.
- **Aplicativo independente para macOS** — Carregamento robusto de PATH e variáveis de ambiente a partir da shell de login, detecção correta de aplicativo empacotado e criação automática de symlink global do `tendril`.
- **Reestruturação de widgets** — Widgets consolidados em um projeto unificado `Ivy.Tendril.Widgets` com diretórios de frontend dedicados por widget.
- **Workflow de mesclagem automática** — Workflow de CI mescla automaticamente a `main` de volta na `development` após o lançamento.
- **Segurança de dependências** — Atualizado `SQLitePCLRaw.lib.e_sqlite3` para 3.50.3 e fixadas versões de dependências frontend (dompurify, vite-plus) para resolver vulnerabilidades conhecidas.

### Correções de Bugs

- Correção na análise de argumentos com traço em `tendril plan create`.
- Correção de erros "database is locked" no SQLite através de uma fábrica de conexões compartilhada e `busy_timeout`.
- Correção de tarefas canceladas/paradas/com falha que revertiam planos ao seu estado anterior.
- Correção da mesclagem de PR dependendo de uma `prRule` obsoleta em vez da flag `PrMerge`.
- Correção de rascunhos que não atualizavam após alterações.
- Correção de falhas intermitentes no Create PR e de mensagens de erro enganosas.
- Correção do preenchimento à esquerda no markdown de Revisão e Rascunhos que não era renderizado.
- Correção da ordem de verificação que não persistia no diálogo Editar Projeto.
- Correção do cálculo de custo de tarefas para ser executado em todos os status usando dados de resultados inline.
- Correção de condição de corrida de gravação perdida no `plan.yaml` ao aceitar uma recomendação.
- Correção de travamento ao navegar para Rascunhos/Revisão com um plano inválido.
- Correção de condição de corrida no desbloqueio de `WaitForJobs` e na detecção de tarefas duplicadas.
- Correção de processos zumbis deixados pelo IvyFrameworkVerification após execuções de testes.
- Correção de travamentos na análise de métricas de uso do Copilot com análise defensiva.
- Correção de falha no Spectre.Console por marcação não escapada na saída do comando doctor.
- Correção de falha na inicialização do onboarding no macOS e Windows quando `TENDRIL_HOME` está vazio.
- Correção de opção Padrão duplicada nos menus suspensos de modelos de perfis de agentes de código.
- Correção de ícone ausente na barra de tarefas do Windows.
- Correção de permissões ACL da pasta de planos bloqueando o ExecutePlan.
- Correção de tarefas SyncRepo duplicadas sendo enfileiradas para o mesmo repositório.
- Correção de colisão de nomes do ContentInput após o framework adicionar seu próprio widget.
- Correção de `SyntaxError` de JS em versões mais antigas do WebKit visando es2020.

## 1.0.39 (2026-05-28)

### Recursos

- **Provedor de agente Gemini** — Adicionada a CLI do Gemini (`gemini`) como um agente de código suportado, com verificação de saúde completa, autenticação e rastreamento de custos de sessão.
- **Suporte a túnel** — Acesso remoto via túneis Cloudflare com código QR nas Configurações, detecção automática de servidor pronto e verificações de rota antes da conexão.
- **Diálogo de teste de agentes** — Novo botão Testar Agente nas Configurações que executa verificações automáticas de instalação, autenticação e modelos para todos os agentes configurados.
- **Seleção de modelo por perfil** — Escolha modelos específicos por perfil de esforço (deep/balanced/quick) nas configurações de Agentes de Código.
- **Catálogos de modelos por provedor** — Substituído o `models.yaml` global por catálogos por provedor e adicionado o comando CLI `tendril models`.
- **Comando `tendril update`** — Autoatualização com atualizador GUI Photino.
- **Injeção de modelos de planos** — Templates de planos são injetados no firmware; o modelo real utilizado é rastreado por tarefa.
- **Títulos legíveis para humanos em ferramentas** — Campo de descrição no ToolCallWire para exibição mais clara na Saída do Agente.
- **Acesso a arquivos de agente em sandbox** — Agentes recebem acesso de escrita a TENDRIL_HOME, pastas de planos e promptwares.
- **Opção `--search` para listagem de planos** — Filtre planos por termo de busca a partir da CLI.
- **AgentApp com prompt de sistema** — Aplicativo de chat beta com agente com prompt de sistema injetado do Tendril.
- **Criar Plano a partir do wallpaper** — Novo botão de Plano no wallpaper abre diretamente o CreatePlanDialog.
- **Botão Copiar todos os Detalhes** — Copie todos os detalhes de depuração da tarefa para a área de transferência na Planilha de Depuração de Tarefas.
- **Extração da visualização da newsletter** — Componente compartilhado de newsletter com melhor relatório de erros.

### Melhorias

- **Divisão de configurações** — Configurações gerais divididas nas abas Agente de Código, Planos e Aparência.
- **Renomeação de PlansApp → DraftsApp** — Badge da barra lateral e navegação atualizados de acordo.
- **Layout de configurações de agentes de código** — Layout aprimorado com nomes de exibição e tratamento de modelo padrão para todos os provedores.
- **Polimento na CLI** — Formatador de console limpo, `--help` sem iniciar o servidor, erro limpo para comandos desconhecidos e formatação de saída do comando doctor.
- **Polimento no AgentOutputView** — Cartões de ferramentas com saída sem quebra automática, títulos mais limpos, espaçamento uniforme e status oculto ao concluir.
- **Melhorias na visualização de processos** — Botões de largura igual, pulso cinza, tokens de cores semânticas para modo escuro e hook deduplicado.
- **Widget TendrilProcessView** — Adicionado à solução com suporte ao modo escuro através de tokens de cores semânticas.
- **Melhorias nos scripts de instalação** — Execução do git verificada, .NET 10 adicionado no início do PATH e scripts mais limpos.
- **Segurança de dependências** — Intervalos de versões de dependências fixados em versões exatas para prevenir ataques de sequestro e confusão.
- **Validação de branch base** — Impede a adição de projetos com branches base inválidas ou repositórios locais inválidos.
- **Saída bruta do agente** — Gravada em `.raw.jsonl` em vez do formato EventWire para melhor depuração.
- **Melhorias no Copilot** — Alternado para prompt via stdin devido ao limite de comprimento de linha de comando no Windows, fallback para `gh copilot` quando o binário independente não estiver no PATH e análise do formato JSON atualizado.
- **Widget CodeBlock** — Saída e resolução do agente utilizam CodeBlock em vez de Markdown bruto.
- **Organização de serviços** — Serviços refatorados em subdiretórios; constantes de status extraídas.

### Correções de Bugs

- Correção na visualização de processos que mostrava contagens invertidas de planos em atualização/execução.
- Correção na resolução do caminho de onboarding quando o parâmetro tendrilHome está vazio.
- Correção de tela de carregamento infinita "Configurando agente" no onboarding.
- Correção na atualização da migração de banco de dados 10→11 tornando a Migração 11 idempotente.
- Correção de barras invertidas em arquivos .csproj e na busca do caminho de Promptwares no onboarding.
- Correção de travamentos no processo do Copilot com timeout de 5s no STDIN.
- Correção de chamada ausente a ResolveCommandShim no PromptwareRunner.
- Correção de limite de comprimento de linha de comando ao iniciar o Gemini.
- Correção de eventos `item.updated` do Codex emitindo UnknownEvent.
- Correção dos modelos padrão para perfis do Copilot e Codex em novas instalações.
- Correção da chave do badge da barra lateral de "plans" para "drafts" após a renomeação.
- Correção de cabeçalhos e estilos duplicados no diálogo Adicionar Projeto.
- Correção de incompatibilidade de índice no diálogo de edição de projeto após adicionar projeto.
- Correção do menu suspenso de modelos que não exibia a opção Padrão.
- Correção na resolução de comandos PTY no Windows para a extensão .cmd.
- Correção de modelos nulos durante a troca de agente.
- Correção do prefixo "undefined:" em mensagens de status de tarefas.
- Correção de nome de projeto duplicado bloqueando o onboarding.
- Correção da análise da saída bruta do agente de onboarding para EventWire em tempo real.
- Correção de janela extra e ícone ausente na barra de tarefas ao iniciar o app no Windows.
- Correção de resultados de ferramentas que não renderizavam no AgentOutputView.
- Correção na análise de resultados de ferramentas do Claude Code a partir de mensagens de usuário.
- Correção de erro 502 no cloudflared lendo o endereço real do servidor.
- Correção do OpenCode com `model: default` para ignorar a flag --model.
- Correção de eventos intermediários step_finish do OpenCode na visualização de saída.

## 1.0.35 (2026-05-20)

### Recursos

- **Notificações toast nativas do SO** — Notificações de desktop para conclusões de planos, falhas e outros eventos, com uma aba dedicada de Notificações nas Configurações.
- **Badge na barra de tarefas** — Contagem de tarefas ativas exibida no badge da barra de tarefas do desktop para status rápido.
- **Assistente para Adicionar Projeto** — A configuração de novos projetos agora utiliza um fluxo guiado estilo assistente correspondente ao onboarding, com capacidade de pular etapas para usuários experientes.
- **Comando de CLI move-verification** — Reordene verificações via `tendril project move-verification` com instruções de ordenação.
- **Onboarding redesenhado** — "Seu Primeiro Projeto" agora é um fluxo em 3 etapas com configuração de novo projeto, feedback progressivo e inscrição na newsletter ao concluir.
- **Comandos CRUD na CLI** — CRUD completo para verificações e projetos via CLI (`tendril project get`, `tendril verification add/remove/move`).
- **Sincronização de commits de planos** — Sincronize commits de planos sob demanda pelo botão Sincronizar em Revisão.
- **Interface CRUD para ReviewAction** — Configure ações de revisão diretamente das Configurações e do onboarding.
- **Comando `tendril reset`** — Redefina o estado do Tendril a partir da CLI.
- **Comando `tendril report-bug`** — Envie relatórios de bugs com contexto do sistema diretamente da CLI.
- **Comando `promptware read-memory`** — Inspecione a memória do promptware a partir da CLI.
- **Modo rascunho para criação de PR** — Opção para criar PRs como rascunhos no GitHub.
- **Aceitar/Recusar Recomendações** — Aceite ou recuse recomendações diretamente no aplicativo de Revisão, com filtragem por planos Concluídos.
- **Aba Git: Bloco de Worktrees** — Exibe detalhes do repositório pai e agrupa commits em seções de worktree.
- **Manter worktrees ativas para planos com Falha** — Worktrees de planos que falharam são preservadas para depuração em vez de serem excluídas.
- **Provedor de agente OpenCode** — Adicionado OpenCode como agente de código suportado.
- **Provedor de agente Copilot CLI** — Adicionada a CLI do GitHub Copilot como agente de código suportado.
- **Flag de CLI `--plans-dir`** — Substitua o diretório de planos para testes E2E e configurações personalizadas.
- **Widget TendrilProcessView** — Widget externo para visualização de processos do Tendril.

### Melhorias

- **Polimento na aba Git** — Ícones em cabeçalhos de seção e estado vazio, árvore hierárquica com indicadores coloridos para arquivos modificados.
- **Estabilidade na aba Alterações** — Correção de oscilações durante a revalidação em segundo plano a cada 30s, comportamento de expansão por padrão e layout de largura total.
- **Limpeza na aba Revisão** — Abas vazias de Artefatos e Recomendações agora são ocultadas; visualizações de planos utilizam tipografia de artigos.
- **Mensagens de commit simplificadas** — Removido o prefixo de ID do plano das instruções de mensagens de commit para um histórico de git mais limpo.
- **Importação de Issues do GitHub aprimorada** — UX refinada para o fluxo de importação de issues do GitHub.
- **Dimensionamento de janelas** — Dimensões padrão de janela atualizadas para funcionar corretamente em telas Retina no macOS, com aplicação de tamanho mínimo.
- **Melhorias em RetryPlan** — Anexa seções de correção ao resumo existente, esclarece configuração de worktree multirrepositório e transmite log bruto para o disco.
- **VerbosityService removido** — Substituído por níveis padrão de ILogger para configuração de logging mais simples.
- **Extração de ServiceRegistration** — Registros de serviços movidos de TendrilServer para um arquivo dedicado `ServiceRegistration.cs`.
- **Saúde do código de onboarding** — Extração de helpers, adição de AgentOnboardingInfo, construtores primários e melhorias nos textos de UX.
- **Permissões de ferramentas de promptware** — Permissões padrão de ferramentas atualizadas para execução de agentes mais segura.
- **Documentação da CLI reestruturada** — Reescrita abrangente da referência da CLI com sintaxe de comandos e exemplos atualizados.
- **Markdown em largura total nas visualizações de planos** — Conteúdo rolável com restrição de largura máxima para legibilidade.
- **Tabela de Tarefas responsiva** — Densidade Grande em tablets e Média em desktops para melhor aproveitamento do espaço.
- **Remoção de geração de verificações** — Removido do diálogo de edição do projeto em favor do gerenciamento de verificações baseado em CLI.
- **Exceções do framework ocultadas** — Exceções internas do framework não aparecem mais como notificações voltadas ao usuário.

### Correções de Bugs

- Correção de reset-to-draft não atualizando a interface imediatamente após a confirmação.
- Correção de ordem de verificação de projeto não preservada na etapa de revisão do onboarding.
- Correção de etapas do onboarding travadas após a conclusão do progresso.
- Correção de piscada "Nenhum resumo disponível" ao abrir um plano em Revisão.
- Correção da aba Alterações piscando a cada 30s durante a revalidação em segundo plano.
- Correção de paralelismo de testes contaminando o `config.yaml` do TeamIvyConfig.
- Correção de hashes de commit armazenados como hashes curtos no sincronizador — agora armazena hashes completos e atualiza a interface após a sincronização.
- Correção de commits perdidos entre execuções de RetryPlan.
- Correção dos caminhos de comandos de ações de revisão para utilizar a sintaxe do PowerShell entre aspas.
- Correção de notificação de erro ao cancelar diálogos com ESC.
- Correção de migração de maiúsculas/minúsculas de subpastas e testes de limpeza quebrados.
- Correção de corrupção do `plan.yaml` durante a execução de UpdatePlan.
- Correção de conteúdo duplicado na Saída do Agente durante transmissões ao vivo.
- Correção de saída de tarefa renderizada duas vezes quando a tarefa é concluída.
- Correção de bug na resolução de PromptwareRoot causando promptwares ausentes.
- Correção de espaçamento e posição do toast de Atualização Disponível.
- Correção de mensagem incompleta "Você tem ." no WallpaperApp.
- Correção de ícone ausente na janela do aplicativo através da atualização de nomes de recursos.
- Correção de `gh auth status` falhando com múltiplas contas do GitHub.
- Correção da planilha de saída exibindo painel vazio para tarefas concluídas.
- Correção de ReportedPlanId incorreto quando nenhuma pasta de plano correspondente existe.
- Correção da ordenação da tabela de Tarefas para exibir tarefas mais recentes primeiro.
- Correção de tarefas concluídas sendo filtradas na reinicialização.
- Correção da sintaxe de invocação de verificação delegada causando falhas em IvyFrameworkVerification.
- Correção do botão Concluir Configuração travando indefinidamente no onboarding.
- Correção de travamento infinito na inicialização de serviços em segundo plano.
- Correção de problema de escopo de nome de aba em Revisão.

## 1.0.22 (2026-04-27)

### Melhorias

- **Tratamento de erros com GitResult\<T\>** — Introduzido o tipo de retorno tipado `GitResult<T>` no GitService para tratamento de erros consistente e explícito em vez de exceções.
- **Extração do DashboardRepository** — Extração de `GetDashboardData` para um DashboardRepository dedicado, separando o acesso a dados da lógica de negócios.
- **Interface ISessionParser** — Extração da análise de sessão por trás de uma interface `ISessionParser` para facilitar testes e futuras variantes de analisadores.
- **Extração do PlanYamlRepairService** — Lógica de reparo de YAML de planos e remoção de worktrees movidas para serviços dedicados (`PlanYamlRepairService`, `WorktreeCleanupService`).
- **Extração do AppShellRouter** — Lógica de roteamento extraída de `OpenApp` para uma classe dedicada `AppShellRouter`.
- **Implementações de IDoctorCheck** — Verificações de diagnóstico do doctor refatoradas em classes individuais `IDoctorCheck` para extensibilidade.
- **Autenticação MCP centralizada** — Autenticação de ferramentas MCP consolidada em um único serviço.
- **Proteção BackgroundServiceActivator** — Adicionada detecção e recuperação para encerramentos silenciosos de processos em segundo plano.
- **Padrão IDisposable no PlanDatabaseService** — Limpeza adequada de recursos para conexões de banco de dados.
- **SoftwareCheckStepView assíncrono** — Substituição de chamadas bloqueantes `.Result` por `await` para uma interface responsiva durante verificações de integridade.
- **Revisão abrangente da qualidade de código** — Redução da complexidade ciclomática em ContentView, PlanController, PlanTools, ConfigService, GithubService, JobLauncher, ModelPricingService, TendrilAppShell e GetPromptDisplay por meio de extração de métodos e refatorações orientadas a dados.
- **Infraestrutura de testes** — Adicionados padrões `TempDirectoryFixture`, `ConfigServiceFixture`, `DatabaseFixture` e `IClassFixture`; cobertura de testes expandida para GitService, PlanValidationService, JobLauncher e alocação de PlanId.
- **Janela de 7 dias no Dashboard** — Contagens de status e de projetos no dashboard agora filtram os últimos 7 dias.

### Correções de Bugs

- Correção de condição de corrida na alocação de PlanId centralizando a alocação no JobService.
- Correção de `ModifyPlanEndpoint` retornando tipos incorretos de resultados.
- Correção de incompatibilidade de tipo de logger no `DashboardRepository`.
- Correção do fechamento automático de issues no GitHub movendo a referência `Closes` para depois do truncamento do corpo.
- Correção de condição de corrida na renomeação de arquivos em `InboxWatcherService`.
- Correção no tratamento de parâmetros anuláveis em `IsValidCommitHash`.
- Correção no tratamento de exceções na tarefa de rastreamento de custos.
- Correção no acesso ao provedor de serviços em `Program.cs`.
- Correção de referência a `TabState` no `AppShellRouter` e modificadores de acesso a métodos manipuladores.
- Remoção do bloqueio de concorrência de repositório no JobService.
- Remoção do `DashboardLoggerAdapter` — passa a usar o logger diretamente.
- Adicionado registro em log para exceções silenciadas em vários serviços.
- Correção em CI/Docker: Node.js v22, tratamento adequado de `IvySource` e remoção de referências obsoletas a Ivy-Framework.

## 1.0.14 (2026-04-10)

### Recursos

- **Fila de prioridade de tarefas** — Os planos agora são executados em ordem de prioridade. Planos no nível de Bug são executados antes de NiceToHave, garantindo que correções críticas entrem primeiro.
- **Importar Issues do GitHub** — Importe issues existentes do GitHub diretamente para o Tendril como rascunhos de planos através do novo diálogo de Importação.
- **Criação de planos multiprojeto** — O diálogo Criar Plano agora suporta a seleção de múltiplos projetos, agregando seus repositórios em um único plano.
- **WorktreeLifecycleLogger** — Trilha de auditoria centralizada para eventos de criação, limpeza e falha de worktrees em PlanReaderService, WorktreeCleanupService e JobService.
- **Aba de Configurações Avançadas** — Nova aba em Configurações para definir opções de nível inferior.

### Melhorias

- **Feedback progressivo de verificações de integridade** — Verificações de integridade agora transmitem resultados individuais conforme são concluídas, em vez de aguardar o término de todas as checagens.
- **Status de PR armazenado no SQLite** — O status de mesclagem de PRs agora é armazenado em cache no banco de dados local com um serviço de sincronização em segundo plano, reduzindo chamadas à API do GitHub.
- **PlanWatcher simplificado** — Substituído o uso intensivo de FileSystemWatcher por uma abordagem mais simples para evitar estouro de buffer devido à alta rotatividade de worktrees.
- **Registro de diagnósticos de worktrees** — Adicionadas checagens rápidas de falha para arquivos `.git` ausentes e melhoradas as mensagens de erro em falhas de criação de worktrees.
- **Detecção recursiva de artefatos de worktrees** — ExecutePlan agora detecta e remove artefatos aninhados de worktrees deixados no diretório Plans por execuções anteriores.
- **Acesso defensivo a dicionários** — MakeSoftwareRow utiliza `GetValueOrDefault` para prevenir KeyNotFoundException em casos extremos.

### Correções de Bugs

- Correção da verificação de integridade do Gemini abrindo janelas do navegador durante a autenticação.
- Correção na checagem `anyAgentHealthy` para usar o status de instalação do agente Gemini.
- Correção na testabilidade do construtor do ConfigService.
- Correção de erros de análise de YAML em `recommendations.yaml`.
- Remoção do Watch Remove redundante do `Ivy.Tendril.csproj`.
- Remoção de `_prStatusCache` não utilizado do GithubService.

## 1.0.12 (2026-04-10)

### Recursos

- **Suporte multiagente** — O Tendril agora suporta múltiplos agentes de código (Claude, Codex, Gemini) com perfis configuráveis (deep, balanced, quick) por agente.
- **Instalador para Windows** — Novo script `install.ps1` para instalação simplificada no Windows.
- **Comando doctor** — Execute `tendril doctor` para diagnosticar problemas de configuração e ambiente.

### Melhorias

- **Revisão da documentação** — Reescrita abrangente de toda a documentação do Tendril com estrutura aprimorada, exemplos e fluxo de onboarding.
- **Polimento no assistente de onboarding** — Interface, textos e layout de etapas aprimorados para a experiência de primeira execução.
- **Promptwares independentes de stack tecnológica** — Removidas referências específicas de stack do ExecutePlan, CreatePlan e outros promptwares para suportar qualquer stack técnica via verificações em `config.yaml`.
- **Substituição de FolderInput por TextInput** — Entrada de caminhos simplificada em todos os aplicativos do Tendril.

### Correções de Bugs

- Correção no tratamento da variável de ambiente `TENDRIL_HOME` em testes.
- Adicionado tratamento de erros em `PlatformHelper.OpenInTerminal` e `OpenInFileManager`.
- Adicionada verificação `File.Exists` antes de ler `plan.yaml` no PlanReaderService.

## 1.0.9 (2026-04-09)

### Recursos

- **Lançamentos estáveis no NuGet** — O Tendril agora publica pacotes estáveis e versionados no NuGet utilizando `Directory.Build.props` para versionamento centralizado.
- **Banco de dados SQLite** — Armazenamento local de dados para planos, tarefas e status de PRs com suporte a migrações.
- **Sistema de recomendações** — Planos agora podem gerar recomendações de acompanhamento que são exibidas no aplicativo Recomendações.
- **Gerenciamento do ciclo de vida de planos** — Máquina de estados completa para planos: Draft, Approved, Executing, Review, Completed, Failed, com transições automáticas.

### Melhorias

- **Rastreamento de custos** — Rastreamento de tokens e custos por tarefa com visualização em dashboard por projeto e tipo de promptware.
- **Enum abrangente de status de tarefas** — Suporte a conversão em string para todos os status de tarefas.
- **Melhorias no tratamento de erros** — Detecção de versões duplicadas de migração e tratamento de erros do FTS5.

## 1.0.0 (2026-04-03)

### Recursos

- **Lançamento inicial** do sistema de gerenciamento de planos Tendril.
- **Aplicativos de planos** — Visualizações de Dashboard, Review, Drafts, Jobs, Icebox, Pull Requests, Recommendations e Trash.
- **Promptwares** — CreatePlan, ExecutePlan, CreatePr, UpdatePlan, SplitPlan, ExpandPlan e CreateIssue.
- **Suporte multiplataforma** — macOS e Windows com detecção automática de plataforma.
- **Execução baseada em worktrees** — Os planos são executados em git worktrees isoladas para manter o repositório principal limpo.
- **Verificações configuráveis** — Build, Test, Format, Lint e CheckResult (com variantes específicas de stack como DotnetBuild, NpmTest).
- **Integração com GitHub** — Criação automática de PRs, rastreamento de status e detecção de mesclagem.
- **Atalhos de teclado** — `Ctrl+Alt+D` para novos rascunhos, com atalhos personalizáveis.
