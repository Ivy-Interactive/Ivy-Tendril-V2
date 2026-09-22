---
title: Z.AI
description: Z.AI предоставляет высокопроизводительный доступ к передовым
  моделям GLM со специальными тарифными планами для написания кода.
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - bigmodel
---

# Z.AI

[Z.AI](https://z.ai) (разработанный [Zhipu AI](https://open.bigmodel.cn)) предоставляет корпоративный доступ к семейству моделей GLM, включая специализированные тарифные планы для написания кода, оптимизированные для автономных агентов программирования, [планов](../02_Concepts/01_Plans.md) и автоматизированных процессов разработки ПО.

## Настройка

1. Получите API-ключ в [Z.AI API Console](https://z.ai/manage-apikey/apikey-list).
2. Авторизуйтесь в [OpenCode](https://opencode.ai) через терминал или встроенный PTY в Tendril:
   ```bash
   opencode auth login
   ```
   Выберите **Z.AI** (или **Z.AI Coding Plan**, если вы оформили подписку на специальный тарифный план для написания кода), затем вставьте свой API-ключ при появлении запроса.
3. Запустите OpenCode и просмотрите доступные модели:
   ```bash
   opencode
   ```
   Введите `/models`, чтобы переключить активную модель.

## Рекомендуемые модели

| Модель                | ID                         | Уровень профиля | Лучше всего подходит для                                     |
| :-------------------- | :------------------------- | :-------------- | :----------------------------------------------------------- |
| **GLM 4.7**           | `glm-4.7`                  | Deep            | Сложная генерация кода, планирование архитектуры, отладка    |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced        | Добавление функций, рефакторинг, код-ревью                   |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick           | Быстрый линтинг, генерация модульных тестов, сводки коммитов |

## Использование с Tendril

1. Откройте приложение Tendril для рабочего стола и перейдите в **Settings > Coding Agent**.
2. Выберите **OpenCode** в качестве активного агента для написания кода (см. [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril вызывает встроенный сайдкар [OpenCode](https://opencode.ai) (`binaries/opencode`), направляя задачи агента напрямую через бэкенд Z.AI.

Вы также можете указать модели GLM для каждого уровня исполнения в `~/.tendril/config.yaml` (см. [Configuration Setup](../03_Configuration/01_Setup.md)):

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
> Тарифный план Z.AI Coding Plan обеспечивает повышенные лимиты частоты запросов и слоты параллельных запросов, специально предназначенные для непрерывной работы агентов и построения сложных [планов](../02_Concepts/01_Plans.md).

## Ссылки

- [Поставщики моделей](_Index.md)
- [Агенты для написания кода](../06_CodingAgents/_Index.md)
- [Платформа Z.AI](https://z.ai)
- [Консоль Z.AI](https://z.ai/manage-apikey/apikey-list)
- [Документация Z.AI + OpenCode](https://docs.z.ai/scenario-example/develop-tools/opencode)
