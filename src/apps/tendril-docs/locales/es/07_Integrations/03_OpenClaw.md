---
title: OpenClaw
description: Integre OpenClaw o cualquier herramienta basada en archivos con Tendril depositando archivos markdown en la carpeta Inbox.
icon: Terminal
searchHints:
  - openclaw
  - inbox
  - carpeta
  - observador de archivos
  - carpeta de depósito
---

# OpenClaw

## Descripción general

Tendril supervisa una **carpeta Inbox** en busca de nuevos archivos markdown y los convierte automáticamente en [planes](../02_Concepts/01_Plans.md). Esto proporciona un punto de integración sencillo basado en archivos para herramientas externas como OpenClaw o scripts personalizados que escriben archivos en el disco.

## Ubicación de la carpeta Inbox

```
$TENDRIL_HOME/Inbox/
```

Para obtener más información sobre el directorio principal de Tendril y su configuración, consulte [Instalación y ajustes](../03_Configuration/01_Setup.md). El observador del sistema de archivos de Tendril monitoriza este directorio en busca de nuevos archivos `.md`.

## Formato del archivo

Deposite un archivo markdown (`.md`) con frontmatter YAML opcional:

```markdown
---
project: ProjectName
sourcePath: optional/path/to/code
---

Describa el plan aquí. Este texto se convierte en la descripción del plan
y se pasa a la [promptware CreatePlan](../02_Concepts/02_Promptwares.md).
```

| Campo        | Requerido | Descripción                                          |
| ------------ | --------- | ---------------------------------------------------- |
| `project`    | No        | Nombre del proyecto de destino (por defecto `Auto`)  |
| `sourcePath` | No        | Indicación de ruta para el código fuente relacionado |

El contenido situado tras el frontmatter se convierte en la descripción del plan.

> [!NOTE]
> Si omite el frontmatter por completo, todo el contenido del archivo se utilizará como la descripción del plan con la configuración predeterminada.

## Ciclo de vida del archivo

1. **Depósito (Drop)** — Deposite un archivo `.md` en la carpeta Inbox
2. **Procesamiento** — El archivo pasa a llamarse `.md.processing` mientras se gestiona
3. **Finalización** — El archivo se elimina una vez que el plan se ha creado correctamente

## Recuperación

Si Tendril se reinicia durante el procesamiento, cualquier archivo `.md.processing` se restaura automáticamente a `.md` y se vuelve a procesar al iniciar el sistema.

## Configuración con OpenClaw

Configure OpenClaw para que escriba su salida como archivos markdown en la carpeta Inbox de Tendril. Cada archivo se convierte en un plan independiente:

1. Establezca el directorio de salida en `$TENDRIL_HOME/Inbox/`
2. Utilice el formato markdown con frontmatter YAML para definir el proyecto de destino
3. Tendril detecta los nuevos archivos automáticamente: no se requieren sondeos ni llamadas a la API
