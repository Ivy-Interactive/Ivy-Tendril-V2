---
title: Gemini CLI
description: Gemini CLI — это агент для написания кода на базе моделей Gemini от Google.
icon: Sparkles
searchHints:
  - gemini
  - google
  - агент для написания кода
---

# Gemini CLI

## Конфигурация

Укажите Gemini в качестве вашего агента для написания кода в `config.yaml`:

```yaml
codingAgent: gemini
```

Или выберите его в разделе **Settings > Coding Agent** (Настройки > Агент для написания кода).

Подробнее о структуре и параметрах `config.yaml` см. в разделе [Установка и настройки](../03_Configuration/01_Setup.md).

## Требования

- Установите бинарный файл `gemini` через [Homebrew](https://brew.sh) или [MacPorts](https://www.macports.org):
  ```bash
  brew install gemini-cli
  # или: sudo port install gemini-cli
  ```
- **Аутентификация**: Обратите внимание, что подкоманды `gemini auth` в CLI нет. Чтобы пройти аутентификацию:
  - При первом запуске `gemini` предложит выполнить **Sign in with Google** через OAuth в вашем браузере.
  - В активной сессии CLI используйте слэш-команду `/auth` (или `/auth login`), чтобы повторно пройти аутентификацию или сменить аккаунт.
  - Для headless- или CI-окружений задайте переменную окружения `GEMINI_API_KEY` (созданную через [Google AI Studio](https://aistudio.google.com/apikey)).

## Профили

Tendril сопоставляет профили Gemini со следующими значениями по умолчанию:

| Профиль    | Модель           | Сценарий использования                 |
| ---------- | ---------------- | -------------------------------------- |
| `deep`     | gemini-3.8-flash | Сложные многофайловые правки           |
| `balanced` | gemini-3.8-flash | Стандартное выполнение планов          |
| `quick`    | gemini-3.8-flash | Простые исправления и небольшие правки |

Профиль выбирается автоматически в зависимости от [уровня сложности плана](../02_Concepts/01_Plans.md) или может быть настроен для каждого [промптвара](../02_Concepts/02_Promptwares.md) в `config.yaml`. Gemini CLI не использует флаги reasoning effort.

Моделью по умолчанию для Gemini в Tendril является `gemini-3.8-flash`.

## Доступные модели

Каталог Gemini в Tendril включает:

- `gemini-3.8-flash` (по умолчанию): Быстрое и высокоэффективное рассуждение следующего поколения, контекстное окно 1M
- `gemini-3.7-flash`: Быстрое и эффективное рассуждение, контекстное окно 1M
- `gemini-3.6-flash`: Мультимодальное рассуждение, контекстное окно 1M
- `gemini-3.1-pro`: Продвинутое рассуждение для сложной архитектуры, контекстное окно 1M
- `gemini-3-pro-preview`: Предварительная версия рассуждений следующего поколения
- `gemini-3-flash-preview`: Предварительная быстрая версия следующего поколения

Переопределите модель в `config.yaml`:

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## Запуск и флаги

Tendril запускает Gemini CLI со следующими параметрами:

- Неинтерактивный режим: `--output-format stream-json --skip-trust --approval-mode <mode>` (где `FullAuto` передает `yolo`, `AcceptEdits` передает `auto_edit`, а `Plan` передает `plan`), а также `--sandbox`, когда режим песочницы включен.
- Терминал интерактивного агента: `gemini --yolo --skip-trust -i "<prompt>"`.
