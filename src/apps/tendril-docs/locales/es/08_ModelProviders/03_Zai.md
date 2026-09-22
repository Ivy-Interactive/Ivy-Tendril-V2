---
title: Z.AI
description: Z.AI proporciona acceso de alto rendimiento a modelos de frontera GLM con opciones de planes dedicados para programación.
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - bigmodel
---

# Z.AI

[Z.AI](https://z.ai) (desarrollado por [Zhipu AI](https://open.bigmodel.cn)) proporciona acceso empresarial a la familia de modelos GLM, incluidos planes de programación especializados y optimizados para agentes de programación autónomos, [planes](../02_Concepts/01_Plans.md) y flujos de trabajo automatizados de desarrollo de software.

## Configuración

1. Obtenga una clave de API en la [Consola de API de Z.AI](https://z.ai/manage-apikey/apikey-list).
2. Autentíquese en [OpenCode](https://opencode.ai) a través de la terminal o del PTY integrado de Tendril:
   ```bash
   opencode auth login
   ```
   Seleccione **Z.AI** (o **Z.AI Coding Plan** si se ha suscrito a un plan dedicado de programación), y luego pegue su clave de API cuando se le solicite.
3. Inicie OpenCode y examine los modelos disponibles:
   ```bash
   opencode
   ```
   Escriba `/models` para cambiar su modelo activo.

## Modelos recomendados

| Modelo                | ID                         | Nivel de perfil | Ideal para                                                              |
| :-------------------- | :------------------------- | :-------------- | :---------------------------------------------------------------------- |
| **GLM 4.7**           | `glm-4.7`                  | Deep            | Generación de código complejo, planificación arquitectónica, depuración |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced        | Nuevas características, refactorización, revisión de código             |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick           | Linting rápido, generación de pruebas unitarias, resúmenes de commits   |

## Uso con Tendril

1. Abra la aplicación de escritorio Tendril y vaya a **Settings > Coding Agent**.
2. Seleccione **OpenCode** como su agente de programación activo (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril invoca el sidecar integrado de [OpenCode](https://opencode.ai) (`binaries/opencode`), canalizando los trabajos de los agentes directamente a través del backend de Z.AI.

También puede especificar modelos GLM por nivel de ejecución en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

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
> El Coding Plan de Z.AI proporciona límites de tasa más altos y ranuras de solicitudes simultáneas diseñadas específicamente para ejecuciones continuas de agentes y compilaciones complejas de [planes](../02_Concepts/01_Plans.md).

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Plataforma Z.AI](https://z.ai)
- [Consola Z.AI](https://z.ai/manage-apikey/apikey-list)
- [Documentación de Z.AI + OpenCode](https://docs.z.ai/scenario-example/develop-tools/opencode)
