---
title: Evroc
description: Provedor de nuvem soberana europeia com modelos de código aberto
  para programação, incluindo Kimi, Llama e Mistral.
icon: Server
searchHints:
  - evroc
  - ue
  - europeu
  - soberano
  - kimi
  - mistral
  - llama
---

# Evroc

O [Evroc](https://cloud.evroc.com) é um provedor europeu de nuvem soberana que opera data centers seguros e ecológicos em toda a Europa. Por meio de sua plataforma de IA "Think", o Evroc oferece inferência compatível com a [OpenAI](https://openai.com) para os principais modelos de código aberto, como Kimi, Llama e Mistral, com total conformidade com o [GDPR](https://gdpr.eu) e soberania de dados europeia.

## Configuração

1. Crie uma conta em [cloud.evroc.com](https://cloud.evroc.com).
2. Gere uma chave de API no Console do Evroc em **Think > Models > + New**.
3. Conecte-se no [OpenCode](https://opencode.ai) usando o sidecar integrado ou o terminal:
   ```bash
   opencode
   ```
   Digite `/connect`, selecione **evroc** e insira sua chave de API.
4. Selecione seu modelo ativo com `/models`.

## Modelos Recomendados

O Evroc hospeda pesos abertos de alta capacidade otimizados para programação e raciocínio técnico:

| Modelo                    | ID                                                                          | Criador                            | Pontos Fortes                                                          |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :--------------------------------------------------------------------- |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | Raciocínio multi-arquivos e programação com contexto longo excepcional |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | Geração e verificação de código rápidas e precisas                     |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | Amplo conhecimento de código, documentação e refatoração               |

> [!TIP]
> Procure por modelos com a tag **Code** no console do Evroc para obter os melhores resultados em tarefas de programação.

## Usando com o Tendril

Você pode rotear a execução de planos do Tendril v2 por meio do Evroc de duas maneiras:

### Opção A: Via OpenCode Integrado

1. No aplicativo desktop do Tendril, acesse **Settings > Coding Agent**.
2. Selecione **OpenCode** como seu agente de programação (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. O Tendril invoca o sidecar integrado do [OpenCode](https://opencode.ai) (`binaries/opencode`), que roteia as requisições através do seu provedor Evroc autenticado.

### Opção B: Endpoint OpenAI Personalizado em `config.yaml`

Como o Evroc oferece uma interface compatível com a OpenAI, você pode configurá-lo diretamente em `codingAgents` no `~/.tendril/config.yaml` (consulte [Configuração](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-evroc-api-key"
      OPENAI_BASE_URL: "https://api.evroc.com/v1"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: balanced
        model: "moonshotai/Kimi-K2.5"
        effort: medium
      - name: quick
        model: "mistralai/Mistral-Small-24B-Instruct-2501"
        effort: low
```

## Links

- [Provedores de Modelos](_Index.md)
- [Agentes de Programação](../06_CodingAgents/_Index.md)
- [Console Cloud do Evroc](https://cloud.evroc.com)
- [Documentação Evroc + OpenCode](https://docs.evroc.com/integrations/opencode.html)
