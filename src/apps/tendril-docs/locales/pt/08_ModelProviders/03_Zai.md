---
title: Z.AI
description: A Z.AI oferece acesso de alto rendimento aos modelos de ponta GLM
  com opções de planos dedicados para programação.
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - bigmodel
---

# Z.AI

A [Z.AI](https://z.ai) (desenvolvida pela [Zhipu AI](https://open.bigmodel.cn)) oferece acesso corporativo à família de modelos GLM, incluindo planos de programação especializados otimizados para agentes de programação autônomos, [planos](../02_Concepts/01_Plans.md) e fluxos de trabalho automatizados de desenvolvimento de software.

## Configuração

1. Obtenha uma chave de API no [Console de API da Z.AI](https://z.ai/manage-apikey/apikey-list).
2. Autentique-se no [OpenCode](https://opencode.ai) através do terminal ou do PTY integrado do Tendril:
   ```bash
   opencode auth login
   ```
   Selecione **Z.AI** (ou **Z.AI Coding Plan** se você tiver assinado um plano de programação dedicado) e cole sua chave de API quando solicitado.
3. Inicie o OpenCode e navegue pelos modelos disponíveis:
   ```bash
   opencode
   ```
   Digite `/models` para alterar seu modelo ativo.

## Modelos Recomendados

| Modelo                | ID                         | Nível de Perfil | Recomendado Para                                                   |
| :-------------------- | :------------------------- | :-------------- | :----------------------------------------------------------------- |
| **GLM 4.7**           | `glm-4.7`                  | Deep            | Geração de código complexo, planejamento de arquitetura, depuração |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced        | Adições de recursos, refatoração, revisão de código                |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick           | Linting rápido, geração de testes unitários, resumos de commit     |

## Usando com o Tendril

1. Abra o aplicativo desktop do Tendril e navegue até **Settings > Coding Agent**.
2. Selecione **OpenCode** como seu agente de programação ativo (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. O Tendril invoca o sidecar integrado do [OpenCode](https://opencode.ai) (`binaries/opencode`), roteando os trabalhos do agente diretamente pelo backend da Z.AI.

Você também pode especificar modelos GLM por nível de execução em `~/.tendril/config.yaml` (consulte [Configuração](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: opencode

codingAgents:
  - name: opencode
    profiles:
      - name: deep
        model: "glm-4.7"
        effort: high
      - name: balanced
        model: "glm-4-plus"
        effort: medium
      - name: quick
        model: "glm-4-air"
        effort: low
```

> [!NOTE]
> O Coding Plan da Z.AI oferece limites de taxa mais altos e slots de requisições concorrentes projetados especificamente para execuções contínuas de agentes e compilações complexas de [planos](../02_Concepts/01_Plans.md).

## Links

- [Provedores de Modelos](_Index.md)
- [Agentes de Programação](../06_CodingAgents/_Index.md)
- [Plataforma Z.AI](https://z.ai)
- [Console da Z.AI](https://z.ai/manage-apikey/apikey-list)
- [Documentação Z.AI + OpenCode](https://docs.z.ai/scenario-example/develop-tools/opencode)
