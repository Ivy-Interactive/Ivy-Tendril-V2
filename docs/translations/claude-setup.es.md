# Guía de configuración de Claude Code para las Skills de Tendril

Esta guía explica cómo instalar, configurar y probar las Skills de Agente de Tendril en Claude Code.

## 1. Instalación mediante el Marketplace de Plugins

Tendril proporciona manifiestos oficiales de plugins en `.claude-plugin/marketplace.json` y `.claude-plugin/plugin.json`.

En Claude Code, añade el repositorio Ivy-Tendril-V2 como fuente del marketplace:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

Luego instala el plugin `tendril-skills`:

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. Desarrollo y pruebas locales

Al desarrollar skills localmente o probar cambios antes de hacer push:

Inicia Claude Code apuntando el directorio de plugins al checkout local de tu repositorio:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Claude Code leerá `.claude-plugin/plugin.json` y montará automáticamente todas las skills definidas en `skills/`.

## 3. Compatibilidad con .claude/skills

Para flujos de trabajo de repositorios locales dentro de Ivy-Tendril-V2:
- Los enlaces simbólicos en `.claude/skills/<skill-name>` apuntan a `../../skills/<skill-name>`.
- Cualquier configuración local existente de Claude Code que haga referencia a `.claude/skills/` continuará funcionando sin problemas y sin reconfiguración manual.

## 4. Invocar skills en Claude Code

Una vez instaladas, usa comandos con barra inclinada directamente en tu sesión de Claude Code:

- `/tendril-debug-plan <plan-id>`: Depura planes fallidos o lentos.
- `/tendril-debug-job <job-id>`: Inspecciona artefactos de trabajos y registros de decisiones del agente.
- `/tendril-review`: Realiza comprobaciones de calidad de código y regresión en los diffs actuales.
- `/tendrillable <url>`: Clasifica issues del backlog según las rúbricas para agentes autónomos.
- `/tendril-release`: Automatiza incrementos de versiones, actualizaciones de dependencias y flujos de lanzamiento.

## Licencia

Las skills y plugins de Tendril están licenciados bajo la [Functional Source License (FSL-1.1-ALv2)](../LICENSE) de la raíz del repositorio.
