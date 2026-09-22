# Руководство по настройке Claude Code для Tendril Skills

В этом руководстве описывается установка, настройка и тестирование навыков агентов Tendril (Agent Skills) в Claude Code.

## 1. Установка через каталог плагинов (Marketplace)

Tendril предоставляет официальные манифесты плагинов в `.claude-plugin/marketplace.json` и `.claude-plugin/plugin.json`.

В Claude Code добавьте репозиторий Ivy-Tendril-V2 в качестве источника каталога:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

Затем установите плагин `tendril-skills`:

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. Локальная разработка и тестирование

При разработке навыков локально или проверке изменений перед отправкой в репозиторий:

Запустите Claude Code, указав каталог плагина, указывающий на локальный клон репозитория:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Claude Code прочитает `.claude-plugin/plugin.json` и автоматически подключит все навыки, определённые в `skills/`.

## 3. Обратная совместимость с .claude/skills

Для локальных рабочих процессов репозитория внутри Ivy-Tendril-V2:
- Символические ссылки в `.claude/skills/<skill-name>` указывают на `../../skills/<skill-name>`.
- Любая существующая локальная конфигурация Claude Code, ссылающаяся на `.claude/skills/`, продолжает работать без необходимости ручной перенастройки.

## 4. Вызов навыков в Claude Code

После установки используйте слэш-команды прямо в сессии Claude Code:

- `/tendril-debug-plan <plan-id>`: Отладка неудачных или медленных планов.
- `/tendril-debug-job <job-id>`: Просмотр артефактов заданий и журналов решений агента.
- `/tendril-review`: Проверка качества кода и тестов на регрессии для текущих диффов.
- `/tendrillable <url>`: Классификация задач бэклога в соответствии с критериями автономных агентов.
- `/tendril-release`: Автоматизация повышения версий, обновления зависимостей и процессов релизов.

## Лицензия

Навыки и плагины Tendril лицензируются на условиях [Functional Source License (FSL-1.1-ALv2)](../LICENSE) в корне репозитория.
