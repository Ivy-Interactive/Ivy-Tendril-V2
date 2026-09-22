---
title: Gemini CLI
description: O Gemini CLI é um agente de programação impulsionado pelos modelos
  Gemini do Google.
icon: Sparkles
searchHints:
  - gemini
  - google
  - agente de programação
---

# Gemini CLI

## Configuração

Defina o Gemini como seu agente de programação no `config.yaml`:

```yaml
codingAgent: gemini
```

Ou selecione-o em **Configurações > Agente de Programação** (**Settings > Coding Agent**).

Para mais detalhes sobre a estrutura e as configurações do `config.yaml`, consulte [Configuração e Definições](../03_Configuration/01_Setup.md).

## Requisitos

- Instale o binário `gemini` via [Homebrew](https://brew.sh) ou [MacPorts](https://www.macports.org):
  ```bash
  brew install gemini-cli
  # ou: sudo port install gemini-cli
  ```
- **Autenticação**: Observe que não há um subcomando CLI `gemini auth`. Para autenticar:
  - Na primeira execução, o `gemini` solicita o **Fazer login com o Google** via OAuth no seu navegador.
  - Em uma sessão ativa do CLI, use o comando slash `/auth` (ou `/auth login`) para autenticar novamente ou alternar contas.
  - Para ambientes headless ou CI, defina a variável de ambiente `GEMINI_API_KEY` (gerada via [Google AI Studio](https://aistudio.google.com/apikey)).

## Perfis

O Tendril mapeia os perfis do Gemini para os seguintes padrões:

| Perfil     | Modelo           | Caso de Uso                                |
| ---------- | ---------------- | ------------------------------------------ |
| `deep`     | gemini-3.8-flash | Alterações complexas em múltiplos arquivos |
| `balanced` | gemini-3.8-flash | Execução de plano padrão                   |
| `quick`    | gemini-3.8-flash | Correções simples e pequenas edições       |

O perfil é selecionado automaticamente com base no [nível de complexidade do plano](../02_Concepts/01_Plans.md), ou pode ser configurado por [promptware](../02_Concepts/02_Promptwares.md) no `config.yaml`. O Gemini CLI não utiliza flags de esforço de raciocínio.

O modelo padrão para o Gemini no Tendril é o `gemini-3.8-flash`.

## Modelos Disponíveis

O catálogo do Gemini no Tendril inclui:

- `gemini-3.8-flash` (padrão): Raciocínio rápido e altamente capaz de última geração, janela de contexto de 1M
- `gemini-3.7-flash`: Raciocínio rápido e capaz, janela de contexto de 1M
- `gemini-3.6-flash`: Raciocínio multimodal, janela de contexto de 1M
- `gemini-3.1-pro`: Raciocínio avançado para arquitetura complexa, janela de contexto de 1M
- `gemini-3-pro-preview`: Prévia de raciocínio de última geração
- `gemini-3-flash-preview`: Prévia rápida de última geração

Substitua o modelo no `config.yaml`:

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## Execução e Flags

O Tendril inicializa o Gemini CLI com:

- Modo não interativo: `--output-format stream-json --skip-trust --approval-mode <mode>` (onde `FullAuto` passa `yolo`, `AcceptEdits` passa `auto_edit`, e `Plan` passa `plan`), e `--sandbox` quando o modo sandbox está ativado.
- Terminal interativo do Agente: `gemini --yolo --skip-trust -i "<prompt>"`.
