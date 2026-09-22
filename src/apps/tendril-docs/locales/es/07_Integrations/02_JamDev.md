---
title: Jam.dev
description: Integre jam.dev con Tendril para crear planes automáticamente a partir de reportes de errores mediante el webhook de la API de bandeja de entrada.
icon: Bug
searchHints:
  - jam
  - jam.dev
  - webhook
  - api de bandeja de entrada
  - reportes de errores
---

# Jam.dev

## Descripción general

[Jam.dev](https://jam.dev) puede enviar informes de errores al endpoint de la API de bandeja de entrada de Tendril, lo que crea [planes](../02_Concepts/01_Plans.md) automáticamente mediante la [promptware](../02_Concepts/02_Promptwares.md) `CreatePlan`. Para obtener más detalles sobre los endpoints HTTP subyacentes, consulte la [API REST](../09_Advanced/02_REST.md).

## URL del webhook

Configure [Jam.dev](https://jam.dev) para que realice solicitudes POST a:

```
http://localhost:5010/api/inbox
```

Reemplace `localhost:5010` por el host y puerto de su instancia de Tendril si están configurados de forma diferente. Para la configuración del servidor, consulte [Instalación y ajustes](../03_Configuration/01_Setup.md).

## Formato de la solicitud

Envíe una solicitud POST con un cuerpo JSON:

```json
{
  "description": "Bug description from jam.dev",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| Campo         | Requerido | Descripción                                                                                 |
| ------------- | --------- | ------------------------------------------------------------------------------------------- |
| `description` | Sí        | El reporte de error o descripción del problema                                              |
| `project`     | No        | Nombre del proyecto de destino (por defecto `Auto`)                                         |
| `sourcePath`  | No        | Indicación de ruta para el código fuente relacionado                                        |
| `force`       | No        | Forzar la creación incluso si ya hay un trabajo idéntico en ejecución (por defecto `false`) |

## Autenticación

Si ha configurado `api.apiKey` en `config.yaml`, inclúyala en el encabezado de solicitud `X-Api-Key`:

```http
X-Api-Key: su-clave-api
```

También puede autenticarse utilizando el secreto del demonio mediante:

```http
Authorization: Bearer <secret>
```

> [!TIP]
> Cuando `api.apiKey` no está configurada, se utiliza el secreto del demonio o la conexión de bucle invertido local (loopback). Para entornos de equipo o remotos, configure una clave de API en `config.yaml`.

## Respuesta

Una solicitud exitosa devuelve HTTP 200:

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

Si se envía una descripción idéntica mientras ya hay un trabajo de `CreatePlan` en curso y `force` no es `true`, Tendril devuelve HTTP 409 Conflict:

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## Configuración en jam.dev

1. Abra la configuración del espacio de trabajo en jam.dev
2. Diríjase a integraciones o webhooks
3. Agregue un nuevo webhook que apunte a la URL de la bandeja de entrada de Tendril (`http://localhost:5010/api/inbox`)
4. Configure los encabezados (como `X-Api-Key`) si la autenticación está habilitada
5. Configure la carga útil (payload) para que coincida con el formato de solicitud anterior
