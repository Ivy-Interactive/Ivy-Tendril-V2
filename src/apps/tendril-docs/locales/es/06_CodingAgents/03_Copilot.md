---
title: Copilot
description: Copilot es un agente de código alternativo impulsado por la CLI de Copilot de GitHub.
icon: Bot
searchHints:
  - copilot
  - github
  - agente de código
---

# Copilot

## Configuración

Establezca Copilot como su agente de código en `config.yaml`:

```yaml
codingAgent: copilot
```

O selecciónelo en **Settings > Coding Agent**.

Para más detalles sobre la estructura y los ajustes de `config.yaml`, consulte [Instalación y ajustes](../03_Configuration/01_Setup.md).

## Requisitos

- La [CLI de GitHub Copilot](https://github.com/features/copilot) debe estar disponible como `copilot` en su PATH. Instálela mediante el script oficial o el cask de [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # o: brew install --cask copilot-cli
  ```
  Tendril recurre automáticamente a `gh copilot` si no se encuentra el binario independiente de `copilot` pero la [CLI de GitHub](https://cli.github.com) (`gh`) está instalada.
- Se requiere una suscripción activa a [GitHub Copilot](https://github.com/features/copilot).
- **Autenticación**: Copilot no dispone de un comando de CLI `login` y no comparte credenciales con `gh auth login`. Para iniciar sesión:
  1. Inicie la CLI en su terminal: `copilot`
  2. En el símbolo del sistema (prompt), ejecute el comando de barra oblicua: `/login`
  3. Para entornos CI desatendidos o sin interfaz gráfica (headless), configure la variable de entorno `COPILOT_GITHUB_TOKEN` (o `GH_TOKEN`) con un token de acceso personal que contenga el permiso `Copilot Requests`.

## Perfiles

Tendril asigna los niveles de esfuerzo a Copilot:

| Perfil     | Modelo  | Esfuerzo | Caso de uso                               |
| ---------- | ------- | -------- | ----------------------------------------- |
| `deep`     | gpt-5.4 | high     | Cambios complejos en varios archivos      |
| `balanced` | gpt-5.4 | medium   | Ejecución estándar de planes              |
| `quick`    | gpt-5.4 | low      | Correcciones simples y pequeñas ediciones |

El perfil se selecciona automáticamente según el [nivel de complejidad del plan](../02_Concepts/01_Plans.md), o puede configurarse por [promptware](../02_Concepts/02_Promptwares.md) en `config.yaml`.

El modelo predeterminado para Copilot en Tendril es `gpt-5.4`.

### Modelos admitidos

GitHub Copilot admite tanto modelos de OpenAI como de Anthropic a través de su entorno de ejecución:

- **Modelos de [OpenAI](https://openai.com)**: `gpt-5.4` (predeterminado), `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5-mini`, `gpt-4.1` (esfuerzo de razonamiento: `low`, `medium`, `high`, `xhigh`).
- **Modelos de [Anthropic Claude](https://code.claude.com/docs)**: `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5` (esfuerzo de razonamiento: `low`, `medium`, `high`, `xhigh`, `max`).

## Instalación de Skills de Tendril para GitHub Copilot

Tendril proporciona skills especializadas para GitHub Copilot en [Visual Studio Code](https://code.visualstudio.com), que cubren depuración de planes, inspección de artefactos de trabajos, revisiones de código y clasificación de issues.

### Uso de la CLI de Skills

Instale skills para su espacio de trabajo:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

O instálelas globalmente en todos los espacios de trabajo:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### Ubicación manual en `.agents/skills/`

Las skills también se pueden colocar directamente en el directorio `.agents/skills/`, `.github/skills/` o `~/.copilot/skills/`:

```bash
mkdir -p .agents/skills
cp -r /path/to/skills/* .agents/skills/
```

Una vez instaladas, las skills aparecen en GitHub Copilot Chat bajo el menú `/skills` y se pueden invocar directamente como comandos de barra oblicua (por ejemplo `/tendril-debug-plan`, `/tendril-review`).

Para más detalles, consulte [Skills de agente](00_Skills.md).
