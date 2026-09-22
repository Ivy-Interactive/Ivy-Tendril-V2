---
title: Obtener ayuda
description: ¿Tienes dudas o problemas? Aquí te explicamos cómo recibir soporte y contactar con la comunidad de Tendril.
icon: LifeBuoy
searchHints:
  - ayuda
  - soporte
  - discord
  - incidencias en github
  - comunidad
  - informe de error
  - report-bug
  - doctor
---

# Obtener ayuda

Si experimentas problemas o tienes preguntas sobre cómo configurar Tendril, dispones de múltiples recursos
de soporte y herramientas de diagnóstico.

## Ejecuta primero los diagnósticos

Antes de enviar una incidencia o solicitar ayuda, ejecuta la herramienta de diagnóstico integrada de Tendril:

```bash
tendril doctor
```

`tendril doctor` comprueba el directorio `$TENDRIL_HOME`, la sintaxis de `config.yaml`, la accesibilidad de la
base de datos [SQLite](https://www.sqlite.org), el directorio de [planes](../02_Concepts/01_Plans.md), [Git](https://git-scm.com/) y
la autenticación de la [CLI de GitHub](https://cli.github.com/).

Si un plan o trabajo específico ha fallado, puedes empaquetar un diagnóstico completo con `tendril report-bug`:

```bash
# Empaqueta el estado del plan, los informes de verificación y los registros del trabajo en un archivo zip
tendril report-bug <plan-id>
```

Esto genera un archivo de diagnóstico comprimido que incluye el YAML del plan, el historial de revisiones, las salidas de verificación
y las transcripciones sin procesar del agente, sin exponer credenciales sensibles.

## Solución de problemas

Para consultar los mensajes de error habituales, migraciones de bases de datos y pasos de recuperación de worktrees, consulta
[Solución de problemas](06_Troubleshooting.md).

## Comunidad en Discord

La vía más rápida para comunicarte con el equipo de desarrollo y otros creadores es nuestro
[servidor de Discord](https://discord.gg/FHgxkDga3y). Únete para hacer preguntas, compartir opiniones y debatir sobre flujos
de trabajo personalizados con promptwares.

## Incidencias en GitHub

¿Has encontrado un error o deseas proponer una nueva funcionalidad? Abre una incidencia en nuestro
[repositorio de GitHub](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues).

> [!TIP]
> Incluye siempre la salida de `tendril doctor` y `tendril version` en la descripción de tu incidencia. Si
> notificas una ejecución fallida de un plan, adjunta el zip generado por `tendril report-bug <plan-id>`
> o el registro del trabajo ubicado en `$TENDRIL_HOME/Jobs/`.

## Próximos pasos

- [Solución de problemas](06_Troubleshooting.md) — patrones de error habituales y sus soluciones.
- [Ciclo de vida y trabajos](../02_Concepts/03_Lifecycle.md) — comprensión de los estados de los trabajos y gestión de errores.
