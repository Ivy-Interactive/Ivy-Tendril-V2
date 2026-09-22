---
title: Scaleway
description: Provedor de nuvem europeu que oferece APIs generativas compatíveis
  com a OpenAI para programação, raciocínio e modelos de pesos abertos.
icon: Server
searchHints:
  - scaleway
  - eu
  - europeu
  - apis generativas
  - soberano
  - qwen
---

# Scaleway

A [Scaleway](https://www.scaleway.com) é uma grande provedora europeia de serviços em nuvem que oferece infraestrutura soberana de IA hospedada em data centers energeticamente eficientes localizados na França, Holanda e Polônia. Por meio de sua plataforma de Generative APIs, a Scaleway fornece endpoints gerenciados e totalmente compatíveis com a [OpenAI](https://openai.com) para os principais modelos abertos.

## Configuração

1. Crie uma conta em [scaleway.com](https://www.scaleway.com).
2. Gere uma chave de API IAM (Secret Key) no console da Scaleway em **Identity and Access Management (IAM)**.
3. Conecte no [OpenCode](https://opencode.ai) usando o sidecar integrado ou o terminal:
   ```bash
   opencode
   ```
   Digite `/connect`, selecione **Scaleway** e cole sua IAM Secret Key.
4. Selecione um modelo usando `/models`.

## Modelos Recomendados

A Scaleway hospeda diversos modelos otimizados para preenchimento de código e engenharia de software:

| Modelo                     | ID do Modelo                      | Criador                              | Nível Recomendado |
| :------------------------- | :-------------------------------- | :----------------------------------- | :---------------- |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep              |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced          |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick             |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Raciocínio) |

## Usando com o Tendril

### Opção A: Via OpenCode Integrado

1. No aplicativo desktop do Tendril, acesse **Settings > Coding Agent**.
2. Selecione **OpenCode** como seu agente ativo (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. O OpenCode usará suas credenciais configuradas da Scaleway para todas as tarefas de execução de planos.

### Opção B: Endpoint Personalizado da OpenAI no `config.yaml`

Como as Generative APIs da Scaleway seguem a especificação da OpenAI em `https://api.scaleway.ai/v1`, você pode configurá-la diretamente em `~/.tendril/config.yaml` (consulte [Configuração](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-scaleway-secret-key"
      OPENAI_BASE_URL: "https://api.scaleway.ai/v1"
    profiles:
      - name: deep
        model: "qwen2.5-coder-32b-instruct"
        effort: high
      - name: balanced
        model: "llama-3.3-70b-instruct"
        effort: medium
      - name: quick
        model: "mistral-small-24b-instruct-2501"
        effort: low
```

> [!NOTE]
> A Scaleway impõe autenticação padrão via token HTTP Bearer. Sua IAM Secret Key funciona diretamente como o `OPENAI_API_KEY`.

## Links

- [Provedores de Modelos](_Index.md)
- [Agentes de Programação](../06_CodingAgents/_Index.md)
- [Plataforma Scaleway](https://www.scaleway.com)
- [Console Scaleway](https://console.scaleway.com)
- [Documentação das Generative APIs da Scaleway](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
