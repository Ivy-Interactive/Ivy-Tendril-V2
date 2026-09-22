---
title: Gemini CLI
description: Gemini CLI es un agente de código impulsado por los modelos Gemini de Google.
icon: Sparkles
searchHints:
  - gemini
  - google
  - agente de código
---

# Gemini CLI

## Configuración

Establezca Gemini como su agente de código en `config.yaml`:

```yaml
codingAgent: gemini
```

O selecciónelo en **Settings > Coding Agent**.

Para más detalles sobre la estructura y los ajustes de `config.yaml`, consulte [Instalación y ajustes](../03_Configuration/01_Setup.md).

## Requisitos

- Instale el binario `gemini` mediante [Homebrew](https://brew.sh) o [MacPorts](https://www.macports.org):
  ```bash
  brew install gemini-cli
  # o: sudo port install gemini-cli
  ```
- **Autenticación**: Tenga en cuenta que no existe un subcomando de CLI `gemini auth`. Para autenticarse:
  - En la primera ejecución, `gemini` le solicita **Sign in with Google** mediante OAuth en su navegador.
  - En una sesión activa de CLI, utilice el comando de barra oblicua `/auth` (o `/auth login`) para volver a autenticarse o cambiar de cuenta.
  - Para entornos CI o sin interfaz gráfica (headless), configure la variable de entorno `GEMINI_API_KEY` (generada a través de [Google AI Studio](https://aistudio.google.com/apikey)).

## Perfiles

Tendril asigna los perfiles de Gemini a los siguientes valores predeterminados:

| Perfil     | Modelo           | Caso de uso                               |
| ---------- | ---------------- | ----------------------------------------- |
| `deep`     | gemini-3.8-flash | Cambios complejos en varios archivos      |
| `balanced` | gemini-3.8-flash | Ejecución estándar de planes              |
| `quick`    | gemini-3.8-flash | Correcciones simples y pequeñas ediciones |

El perfil se selecciona automáticamente según el [nivel de complejidad del plan](../02_Concepts/01_Plans.md), o puede configurarse por [promptware](../02_Concepts/02_Promptwares.md) en `config.yaml`. La CLI de Gemini no utiliza flags de esfuerzo de razonamiento.

El modelo predeterminado para Gemini en Tendril es `gemini-3.8-flash`.

## Modelos disponibles

El catálogo de Gemini en Tendril incluye:

- `gemini-3.8-flash` (predeterminado): Razonamiento rápido y de alta capacidad de última generación, ventana de contexto de 1M
- `gemini-3.7-flash`: Razonamiento rápido y capaz, ventana de contexto de 1M
- `gemini-3.6-flash`: Razonamiento multimodal, ventana de contexto de 1M
- `gemini-3.1-pro`: Razonamiento avanzado para arquitectura compleja, ventana de contexto de 1M
- `gemini-3-pro-preview`: Vista previa de razonamiento de última generación
- `gemini-3-flash-preview`: Vista previa rápida de última generación

Invalide el modelo en `config.yaml`:

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## Ejecución y flags

Tendril inicia la CLI de Gemini con:

- Modo no interactivo: `--output-format stream-json --skip-trust --approval-mode <mode>` (donde `FullAuto` pasa `yolo`, `AcceptEdits` pasa `auto_edit`, y `Plan` pasa `plan`), y `--sandbox` cuando el modo sandbox está habilitado.
- Terminal interactiva del Agente: `gemini --yolo --skip-trust -i "<prompt>"`.
