---
title: NVIDIA
description: Acesse microserviços de inferência NVIDIA NIM e modelos abertos
  acelerados para tarefas de programação via NVIDIA Build.
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

O [NVIDIA Build](https://build.nvidia.com) oferece acesso aos endpoints do NVIDIA NIM (Inference Microservice), disponibilizando inferência acelerada por GPU e otimizada para empresas para modelos abertos de ponta, incluindo [Llama da Meta](https://llama.meta.com), [DeepSeek](https://www.deepseek.com), [Mistral AI](https://mistral.ai) e [Qwen](https://github.com/QwenLM).

## Configuração via OpenCode

1. Gere uma chave de API (iniciada com `nvapi-`) em [build.nvidia.com](https://build.nvidia.com).
2. Conecte no [OpenCode](https://opencode.ai) usando o terminal ou o PTY integrado do Tendril:
   ```bash
   opencode
   ```
   Digite `/connect`, selecione **NVIDIA** e cole sua chave de API.
3. Alterne seu modelo ativo usando `/models`.

## Modelos Recomendados

O NVIDIA NIM hospeda compilações otimizadas para os principais modelos de código:

| Modelo                     | Identificador NIM                 | Nível de Execução | Criador                              |
| :------------------------- | :-------------------------------- | :---------------- | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep              | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Reasoning)  | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanced          | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Quick             | [Meta AI](https://llama.meta.com)    |

## Usando com o Tendril

### Opção A: Via OpenCode Integrado

1. No aplicativo desktop do Tendril, abra **Settings > Coding Agent**.
2. Selecione **OpenCode** como seu agente de programação ativo (consulte [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. O Tendril executa os planos através do sidecar integrado do [OpenCode](https://opencode.ai) utilizando seus modelos autenticados do NVIDIA NIM.

### Opção B: API Direta do NIM no `config.yaml`

O NVIDIA NIM oferece endpoints totalmente compatíveis com a [OpenAI](https://openai.com) em `https://integrate.api.nvidia.com/v1`. Você pode configurar o Tendril para conectar diretamente em `~/.tendril/config.yaml` (consulte [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "nvapi-..."
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1"
    profiles:
      - name: deep
        model: "meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "qwen/qwen2.5-coder-32b-instruct"
        effort: medium
      - name: quick
        model: "meta/llama-3.1-8b-instruct"
        effort: low
```

> [!TIP]
> Os endpoints do NVIDIA NIM utilizam esquemas padrão do OpenAI Chat Completion com streaming de tokens ativado, tornando-os totalmente compatíveis com os visualizadores de saída em tempo real do Tendril.

## Links

- [Provedores de Modelos](_Index.md)
- [Agentes de Programação](../06_CodingAgents/_Index.md)
- [Catálogo do NVIDIA Build](https://build.nvidia.com)
- [Documentação do NVIDIA NIM](https://build.nvidia.com/spark/cli-coding-agent)
