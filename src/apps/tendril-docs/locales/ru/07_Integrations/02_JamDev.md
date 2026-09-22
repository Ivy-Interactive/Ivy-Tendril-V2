---
title: Jam.dev
description: Интеграция jam.dev с Tendril для автоматического создания планов из
  отчетов об ошибках через вебхук inbox API.
icon: Bug
searchHints:
  - jam
  - jam.dev
  - вебхук
  - inbox api
  - отчеты об ошибках
---

# Jam.dev

## Обзор

[Jam.dev](https://jam.dev) может отправлять отчеты об ошибках в эндпоинт inbox API системы Tendril, который автоматически создает [планы](../02_Concepts/01_Plans.md) с помощью [промптваря](../02_Concepts/02_Promptwares.md) `CreatePlan`. Подробнее о базовых HTTP-эндпоинтах см. в разделе [REST API](../09_Advanced/02_REST.md).

## URL вебхука

Настройте отправку POST-запросов из [Jam.dev](https://jam.dev) по адресу:

```
http://localhost:5010/api/inbox
```

Замените `localhost:5010` на хост и порт вашего экземпляра Tendril, если они настроены иначе. Информацию о конфигурации сервера см. в разделе [Установка и настройки](../03_Configuration/01_Setup.md).

## Формат запроса

Отправьте POST-запрос с телом в формате JSON:

```json
{
  "description": "Bug description from jam.dev",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| Поле          | Обязательно | Описание                                                                                    |
| ------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `description` | Да          | Описание баг-репорта или проблемы                                                           |
| `project`     | Нет         | Имя целевого проекта (по умолчанию `Auto`)                                                  |
| `sourcePath`  | Нет         | Подсказка пути к связанному исходному коду                                                  |
| `force`       | Нет         | Принудительное создание, даже если идентичная задача уже выполняется (по умолчанию `false`) |

## Аутентификация

Если в `config.yaml` настроен параметр `api.apiKey`, передайте его в заголовке запроса `X-Api-Key`:

```http
X-Api-Key: your-api-key
```

Вы также можете пройти аутентификацию с помощью секрета демона через:

```http
Authorization: Bearer <secret>
```

> [!TIP]
> Если параметр `api.apiKey` не настроен, используется секрет демона или локальное loopback-соединение. Для командных или удаленных сред настройте API-ключ в `config.yaml`.

## Ответ

Успешный запрос возвращает HTTP 200:

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

Если отправлено идентичное описание, пока задача `CreatePlan` уже выполняется, и `force` не установлен в `true`, Tendril возвращает HTTP 409 Conflict:

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## Настройка в jam.dev

1. Откройте настройки рабочего пространства jam.dev
2. Перейдите в раздел интеграций или вебхуков
3. Добавьте новый вебхук, указывающий на URL Tendril inbox (`http://localhost:5010/api/inbox`)
4. Настройте заголовки (например, `X-Api-Key`), если включена аутентификация
5. Настройте формат полезной нагрузки (payload) в соответствии с приведенным выше форматом запроса
