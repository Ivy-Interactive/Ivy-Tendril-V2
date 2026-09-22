---
title: Claude Code
description: Claude Code es el agente de código predeterminado en Tendril, impulsado por los modelos Claude de Anthropic.
icon: Bot
searchHints:
  - claude
  - claude code
  - anthropic
  - agente de código
  - agente de ia
---

# Claude Code

## Configuración

Establezca Claude Code como su agente de código en `config.yaml`:

```yaml
codingAgent: claude
```

O selecciónelo en **Settings > Coding Agent**.

Para más detalles sobre la estructura y los ajustes de `config.yaml`, consulte [Instalación y ajustes](../03_Configuration/01_Setup.md).

## Requisitos

- La CLI de [Claude Code](https://code.claude.com/docs) debe estar instalada y disponible como `claude` en su PATH. Utilice el instalador nativo o el cask de [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # o: brew install --cask claude-code
  ```
- Autentíquese antes de usar Tendril ejecutando `claude auth login` (o `claude login`). Claude Code requiere un plan [Anthropic](https://www.anthropic.com) Pro, Max, Team, Enterprise o [Console](https://console.anthropic.com) (el nivel gratuito de claude.ai no incluye acceso a la CLI).
- Para entornos sin interfaz gráfica (headless) o backends alternativos, configure `ANTHROPIC_API_KEY`, o configure [AWS Bedrock](https://aws.amazon.com/bedrock/) (`CLAUDE_CODE_USE_BEDROCK=1`) o [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) (`CLAUDE_CODE_USE_VERTEX=1`).

## Perfiles

Tendril asigna los niveles de esfuerzo a los modelos de Claude:

| Perfil     | Modelo | Esfuerzo | Caso de uso                                        |
| ---------- | ------ | -------- | -------------------------------------------------- |
| `deep`     | opus   | max      | Cambios complejos en varios archivos, arquitectura |
| `balanced` | sonnet | high     | Ejecución estándar de planes, la mayoría de tareas |
| `quick`    | haiku  | low      | Correcciones simples, formateo, ediciones pequeñas |

El perfil se selecciona automáticamente según el [nivel de complejidad del plan](../02_Concepts/01_Plans.md), o puede configurarse por [promptware](../02_Concepts/02_Promptwares.md) en `config.yaml`.

## Modelos disponibles

| Modelo           | ID                 | Ventana de contexto | Precio (entrada / salida por MTok) |
| ---------------- | ------------------ | ------------------- | ---------------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M                  | $10.00 / $50.00                    |
| Claude Opus 5    | `claude-opus-5`    | 1M                  | $5.00 / $25.00                     |
| Claude Opus      | `opus`             | 1M                  | $5.00 / $25.00                     |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M                  | $2.00 / $10.00                     |
| Claude Sonnet    | `sonnet`           | 1M                  | $2.00 / $10.00                     |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k                | $1.00 / $5.00                      |
| Claude Haiku     | `haiku`            | 200k                | $1.00 / $5.00                      |

`opus`, `sonnet` y `haiku` son alias de Claude Code que siguen el modelo actual de Anthropic para ese nivel, mientras que `claude-opus-5` (el valor predeterminado del catálogo) y `claude-fable-5-1` son identificadores fijados.

El precio introductorio de Claude Sonnet de $2.00 / $10.00 se aplica hasta el 2026-08-31; el precio estándar de $3.00 / $15.00 se aplica a partir de entonces.

## Plugin de Skills de Tendril

Puede instalar las skills oficiales de ingeniería y depuración de Tendril como un plugin de Claude Code:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Durante el desarrollo y las pruebas locales, cargue las skills directamente desde su copia local:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Para más detalles, consulte [Skills de agente](00_Skills.md).
