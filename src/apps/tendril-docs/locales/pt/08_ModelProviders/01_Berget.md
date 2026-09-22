---
title: Berget AI
description: Provedor europeu de infraestrutura de IA que oferece modelos Kimi e
  GLM com total residência de dados na UE e suporte nativo ao cartão BYO do
  Tendril v2.
icon: Server
searchHints:
  - berget
  - ue
  - europeu
  - kimi
  - glm
  - moonshot
---

# Berget AI

O [Berget AI](https://berget.ai) é um provedor europeu de infraestrutura de IA que oferece inferência de LLM soberana e de alto desempenho com residência de dados garantida na UE, na Suécia. O Berget disponibiliza endpoints compatíveis com a [OpenAI](https://openai.com), hospedando modelos de código aberto de ponta, incluindo o Kimi K3 da [Moonshot AI](https://moonshot.cn) e a família GLM da [Zhipu AI](https://open.bigmodel.cn), em total conformidade com o [GDPR](https://gdpr.eu).

No Tendril v2, o Berget AI é suportado tanto como um cartão nativo **Bring Your Own LLM** no aplicativo desktop quanto por meio do sidecar integrado [OpenCode](https://opencode.ai).

## Configuração via Tendril Desktop

A maneira mais simples de usar o Berget AI é através do cartão BYO nativo nas configurações do desktop:

1. Crie uma conta e gere uma chave de API em [console.berget.ai](https://console.berget.ai).
2. Abra o Tendril e navegue até **Settings > Coding Agent**.
3. Em **Bring Your Own LLM**, clique no cartão **Berget AI**.
4. Cole sua chave de API no campo **API Key** e clique em **Save**.

> [!NOTE]
> Não há campo de URL base para configurar para o Berget na interface. O Tendril v2 fixa automaticamente o endpoint em `https://api.berget.ai/v1` e roteia as requisições através do sidecar integrado [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Configuração Manual em `config.yaml`

Você também pode configurar o Berget AI diretamente em `~/.tendril/config.yaml` (consulte [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-berget-..."
      OPENAI_BASE_URL: "https://api.berget.ai/v1"
      ANTHROPIC_API_KEY: "sk-berget-..."
      ANTHROPIC_BASE_URL: "https://api.berget.ai"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: max
      - name: balanced
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: quick
        model: "moonshotai/Kimi-K3"
        effort: low
```

## Modelos Recomendados

O resolvedor de perfis do Tendril v2 mapeia o Berget AI diretamente para o Kimi K3 em todos os níveis:

| Nível        | ID do Modelo         | Esforço Padrão | Finalidade                                                           |
| :----------- | :------------------- | :------------- | :------------------------------------------------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`          | Planejamento arquitetural, raciocínio complexo, grandes refatorações |
| **Balanced** | `moonshotai/Kimi-K3` | `high`         | Execução padrão de planos e geração de código                        |
| **Quick**    | `moonshotai/Kimi-K3` | `low`          | Verificação rápida, resumos de commits, relatórios de status         |

O Berget também fornece modelos da família GLM (como o `GLM-4.7`). Você pode definir qualquer ID de modelo disponível do Berget na sua configuração de perfil ou selecioná-lo com `/models` no [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Configuração via CLI do OpenCode

Alternativamente, você pode configurar o Berget através do OpenCode:

1. Execute o utilitário de configuração do Berget:
   ```bash
   npx berget code init
   ```
2. Inicie o OpenCode:
   ```bash
   opencode
   ```
3. Defina seu agente ativo no Tendril para o OpenCode em **Settings > Coding Agent** (`codingAgent: opencode`).

> [!TIP]
> O Tendril v2 inclui o binário do [OpenCode](https://opencode.ai) integrado (`binaries/opencode`). Não é necessário instalar o Node.js ou o OpenCode globalmente no seu sistema para usar o Berget com o Tendril. Saiba mais no [OpenCode Agent Guide](../06_CodingAgents/04_OpenCode.md).

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Berget AI Homepage](https://berget.ai)
- [Berget Console](https://console.berget.ai)
- [Berget + OpenCode Documentation](https://docs.berget.ai/integrations/opencode)
