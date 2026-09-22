# Guía de configuración de Cursor para las Skills de Tendril

Esta guía explica cómo instalar y configurar las Skills de Agente de Tendril en Cursor.

## 1. Instalación rápida (Skills CLI)

Instala las skills de Tendril en tu proyecto de Cursor usando la CLI de skills:

```bash
# Instalación a nivel de proyecto (se instala en .cursor/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# Instalación global (en todos los espacios de trabajo de Cursor)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Estructura de directorios en Cursor

Cursor busca definiciones de skills en las siguientes ubicaciones:

- **Nivel de proyecto**: `.cursor/skills/<skill-name>/SKILL.md`
- **Nivel global / de usuario**: `~/.cursor/skills/<skill-name>/SKILL.md` (macOS/Linux) o `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md` (Windows)

Cada carpeta contiene:
- `SKILL.md`: Instrucciones principales con frontmatter YAML
- Documentación de referencia complementaria y scripts

## 3. Interacción con las reglas de Cursor (.cursorrules)

Puedes hacer referencia a las skills de Tendril desde el archivo `.cursorrules` de tu proyecto o archivos `.cursor/rules/*.mdc`:

```markdown
Al depurar planes fallidos o revisar cambios:
- Consulta src/skills/tendril-debug-plan para el diagnóstico de ejecución de planes.
- Ejecuta los procedimientos de src/skills/tendril-review antes de finalizar las pull requests.
```

## 4. Uso en el chat del agente de Cursor

En la ventana de chat del agente de Cursor:
- Escribe `@tendril-debug-plan` o pídele al agente que inspeccione un plan siguiendo sus instrucciones.
- Pídele a Cursor que ejecute `/tendril-review` sobre el diff git activo.
- Ejecuta `/tendrillable` para clasificar issues según su idoneidad para agentes.

## Licencia

Las skills y plugins de Tendril están licenciados bajo la [Functional Source License (FSL-1.1-ALv2)](../LICENSE) de la raíz del repositorio.
