---
title: Provedores de Modelos
description: Configure provedores de modelos e backends de inferência para
  agentes do Tendril v2 usando cartões BYO integrados ou o sidecar OpenCode
  incluído.
icon: Server
groupExpanded: true
searchHints:
  - provedores de modelos
  - provedores
  - api
  - inferência
  - gateway
  - llm
  - opencode
  - traga seu próprio llm
  - byo
---

# Provedores de Modelos

O Tendril v2 suporta roteamento flexível de provedores de modelos, permitindo que você execute [agentes de programação](../06_CodingAgents/_Index.md) em infraestrutura soberana europeia, gateways de API unificados, hubs de modelos em nuvem ou endpoints locais on-premises.

No Tendril v2, a execução de provedores de modelos é roteada por meio de dois mecanismos principais:

1. **Traga Seu Próprio LLM Nativo (Bring Your Own LLM - BYO LLM)**: Cartões de configuração integrados e [configuração](../03_Configuration/01_Setup.md) direta em `config.yaml` para [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) e o provedor soberano europeu [Berget AI](01_Berget.md).
2. **Sidecar OpenCode Incluído**: O Tendril v2 vem com o binário do [OpenCode](https://opencode.ai) incluído por padrão (`binaries/opencode`), fornecendo acesso direto a gateways multiprovedores e backends de inferência personalizados sem exigir instalações manuais de CLI (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).

## Provedores Suportados

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — Provedor europeu de infraestrutura de IA que oferece modelos Kimi e GLM com total residência de dados na UE e integração de primeira classe com cartões BYO do Tendril.
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — Provedor de nuvem soberana europeia com modelos de programação de código aberto, incluindo Kimi, Llama e Mistral.
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — Acesso de alto rendimento a modelos GLM com opções de planos dedicados de programação.
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — Provedor de nuvem europeu que oferece Generative APIs compatíveis com OpenAI para programação e raciocínio.
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — Gateway de IA que oferece acesso unificado a mais de 300 modelos com opções de residência de dados na UE.
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — Gateway de API unificado que oferece acesso a modelos da Anthropic, OpenAI, Google, Meta e DeepSeek.
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — Inferência serverless via Cloudflare Workers AI junto com integração de ferramentas MCP do Workers.
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — Microsserviços [NVIDIA NIM](https://build.nvidia.com) de nível empresarial e modelos abertos hospedados no NVIDIA Build.
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — Roteamento unificado multiprovedor com telemetria integrada, limites de gastos e cache de requisições.

## Como Funciona a Configuração

### 1. No Aplicativo Desktop do Tendril

Navegue até **Settings > Coding Agent**:

- **Agentes Pré-Configurados**: Selecione entre os agentes incluídos, como [Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) e [modelos locais no dispositivo da Apple](https://developer.apple.com).
- **Cartões Traga Seu Próprio LLM (BYO)**: Escolha **OpenAI**, **Anthropic** ou **Berget AI**. Insira sua chave de API e o Tendril configurará automaticamente as URLs base apropriadas, as distribuirá nas respectivas variáveis de ambiente do SDK e preencherá os padrões de perfis em camadas.
- **Níveis de Perfil**: Configure modelos padrão e níveis de esforço de raciocínio em três camadas de execução:
  - **Deep**: Raciocínio de alto esforço para planejamento arquitetural, refatorações complexas e rascunhos iniciais.
  - **Balanced**: Capacidade e velocidade equilibradas para implementação de recursos do dia a dia e correções de revisão.
  - **Quick**: Modelos rápidos e de baixa latência para geração de mensagens de commit, verificação de testes e checagens de status.

### 2. No `config.yaml`

Todas as configurações de provedores e agentes persistem em `~/.tendril/config.yaml` (consulte [Instalação e Configuração](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy # or opencode, claude, codex, gemini, etc.

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-..."
      OPENAI_BASE_URL: "https://api.openai.com/v1"
      ANTHROPIC_API_KEY: "sk-..."
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    profiles:
      - name: deep
        model: "gpt-5.6-sol"
        effort: high
      - name: balanced
        model: "gpt-5.6-terra"
        effort: medium
      - name: quick
        model: "gpt-5.6-luna"
        effort: low
```

> [!TIP]
> Ao salvar configurações BYO, o daemon do Tendril sincroniza automaticamente as URLs base: o SDK da [OpenAI](https://openai.com) espera `/v1` no final da URL, enquanto o SDK da [Anthropic](https://www.anthropic.com) espera apenas o host sem `/v1`.

### 3. Via o Sidecar OpenCode Incluído

Para provedores de gateway (como [OpenRouter](06_OpenRouter.md), [Evroc](02_Evroc.md), [Scaleway](04_Scaleway.md) ou [Opper](05_Opper.md)):

1. Inicie o OpenCode via terminal ou pelo terminal integrado do Tendril:
   ```bash
   opencode
   ```
2. Digite `/connect` e selecione seu provedor, ou execute `opencode auth login`.
3. Defina seu agente de programação ativo no Tendril como OpenCode em **Settings > Coding Agent** (`codingAgent: opencode`).
4. O Tendril despacha todas as tarefas de execução de planos através do runtime configurado do [OpenCode](../06_CodingAgents/04_OpenCode.md).

> [!NOTE]
> O Tendril v2 enriquece metadados de modelos disponíveis automaticamente via [models.dev](https://models.dev). O cache é armazenado localmente no [SQLite](https://www.sqlite.org) e atualizado em segundo plano ou sob demanda via `POST /api/models/refresh`.
