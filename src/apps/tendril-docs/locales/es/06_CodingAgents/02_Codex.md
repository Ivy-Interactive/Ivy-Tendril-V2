---
title: Codex
description: Codex es un agente de código alternativo impulsado por los modelos GPT de OpenAI.
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - agente de código
---

# Codex

## Configuración

Establezca Codex como su agente de código en `config.yaml`:

```yaml
codingAgent: codex
```

O selecciónelo en **Settings > Coding Agent**.

Para más detalles sobre la estructura y los ajustes de `config.yaml`, consulte [Instalación y ajustes](../03_Configuration/01_Setup.md).

## Requisitos

- La CLI de [Codex](https://chatgpt.com/codex) debe estar instalada y disponible como `codex` en su PATH. Instálela mediante el script oficial o el cask de [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # o: brew install --cask codex
  ```
- Autentíquese antes de usar Tendril ejecutando:
  ```bash
  codex login
  ```
  Para entornos sin interfaz gráfica (headless) o desatendidos, pase una [clave de API de la plataforma OpenAI](https://platform.openai.com/api-keys) a través de stdin:
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## Perfiles

Tendril asigna los niveles de esfuerzo a los modelos de Codex:

| Perfil     | Modelo        | Esfuerzo | Caso de uso                               |
| ---------- | ------------- | -------- | ----------------------------------------- |
| `deep`     | gpt-5.6-sol   | high     | Cambios complejos en varios archivos      |
| `balanced` | gpt-5.6-terra | medium   | Ejecución estándar de planes              |
| `quick`    | gpt-5.6-luna  | low      | Correcciones simples y pequeñas ediciones |

El perfil se selecciona automáticamente según el [nivel de complejidad del plan](../02_Concepts/01_Plans.md), o puede configurarse por [promptware](../02_Concepts/02_Promptwares.md) en `config.yaml`.

El modelo predeterminado para Codex en Tendril es `gpt-5.6-terra`.

### Modelos admitidos y esfuerzo de razonamiento

El catálogo de Codex admite los siguientes modelos de [OpenAI](https://openai.com):

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra` (predeterminado)
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

Codex admite cinco niveles de esfuerzo de razonamiento: `none`, `low`, `medium`, `high` y `xhigh`. El nivel `none` permite ejecutar Codex sin sobrecarga de razonamiento para ediciones rápidas.

## Ejecución y aislamiento (sandboxing)

Tendril inicia Codex mediante `codex exec` en modo no interactivo:

- El aislamiento (sandbox) se establece por defecto en `--sandbox workspace-write` con acceso a la red habilitado. Cuando el modo sandbox está deshabilitado en la configuración de seguridad del proyecto, Tendril pasa `danger-full-access`.
- Las rutas permitidas adicionales definidas en las reglas de seguridad se suministran mediante `--add-dir`.
- Los servidores [MCP (Model Context Protocol)](https://modelcontextprotocol.io) configurados se escriben en una configuración JSON temporal y se suministran a través de `--mcp-config`.
