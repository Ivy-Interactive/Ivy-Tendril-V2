---
title: Jam.dev
description: Integrera jam.dev med Tendril för att automatiskt skapa planer från
  felrapporter via inbox API-webhooken.
icon: Bug
searchHints:
  - jam
  - jam.dev
  - webhook
  - inbox api
  - felrapporter
---

# Jam.dev

## Översikt

[Jam.dev](https://jam.dev) kan skicka felrapporter till Tendrils inbox API-slutpunkt, vilket automatiskt skapar [planer](../02_Concepts/01_Plans.md) via `CreatePlan`-[promptware](../02_Concepts/02_Promptwares.md). För mer information om de underliggande HTTP-slutpunkterna, se [REST API](../09_Advanced/02_REST.md).

## Webhook-URL

Konfigurera [Jam.dev](https://jam.dev) att göra POST-anrop till:

```
http://localhost:5010/api/inbox
```

Ersätt `localhost:5010` med din Tendril-värd och port om den är konfigurerad annorlunda. För serverkonfiguration, se [Installation och inställningar](../03_Configuration/01_Setup.md).

## Förfrågningsformat

Skicka en POST-förfrågan med en JSON-body:

```json
{
  "description": "Bug description from jam.dev",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| Fält          | Obligatoriskt | Beskrivning                                                                      |
| ------------- | ------------- | -------------------------------------------------------------------------------- |
| `description` | Ja            | Felrapporten eller ärendebeskrivningen                                           |
| `project`     | Nej           | Målprojektnamn (standardvärde är `Auto`)                                         |
| `sourcePath`  | Nej           | Sökvägshandledning för relaterad källkod                                         |
| `force`       | Nej           | Tvinga skapande även om ett identiskt jobb redan körs (standardvärde är `false`) |

## Autentisering

Om du har konfigurerat `api.apiKey` i `config.yaml`, inkludera den som begärandehuvudet `X-Api-Key`:

```http
X-Api-Key: your-api-key
```

Du kan även autentisera med demonhemligheten (daemon secret) via:

```http
Authorization: Bearer <secret>
```

> [!TIP]
> När `api.apiKey` inte är konfigurerad används demonhemligheten eller lokal loopback-anslutning. För team- eller fjärrmiljöer, konfigurera en API-nyckel i `config.yaml`.

## Svar

En lyckad förfrågan returnerar HTTP 200:

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

Om en identisk beskrivning skickas in medan ett `CreatePlan`-jobb redan pågår och `force` inte är `true`, returnerar Tendril HTTP 409 Conflict:

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## Konfigurera i jam.dev

1. Öppna inställningarna för din jam.dev-arbetsyta
2. Navigera till integrationer eller webhooks
3. Lägg till en ny webhook som pekar på din Tendril inbox-URL (`http://localhost:5010/api/inbox`)
4. Konfigurera headers (såsom `X-Api-Key`) om autentisering är aktiverad
5. Konfigurera nyttolasten (payload) så att den matchar förfrågningsformatet ovan
