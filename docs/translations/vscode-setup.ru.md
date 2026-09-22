# Руководство по настройке Visual Studio Code для Tendril Skills

В этом руководстве объясняется, как установить, настроить и использовать навыки агентов Tendril (Agent Skills) с GitHub Copilot и другими расширениями ИИ-агентов в Visual Studio Code.

## 1. Быстрая установка (Skills CLI)

Самый простой способ установить навыки Tendril для GitHub Copilot в VS Code — использовать открытый CLI для навыков агентов (skills CLI):

```bash
# Установка на уровне проекта (устанавливается в .agents/skills/ или .github/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# Глобальная установка (доступно во всех рабочих областях VS Code)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Чтобы установить отдельные навыки вместо полного пакета:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. Пути ручной установки

Если вы предпочитаете размещать папки навыков вручную без использования CLI:

- **Репозиторий рабочей области (рекомендуется для команд)**:
  Скопируйте навыки в `.agents/skills/<skill-name>` или `.github/skills/<skill-name>` в корне вашей рабочей области.
- **Профиль пользователя (глобально для всех проектов)**:
  Скопируйте навыки в `~/.copilot/skills/<skill-name>` (macOS/Linux) или `%USERPROFILE%\.copilot\skills\<skill-name>` (Windows).

Убедитесь, что каждая папка навыка содержит файл спецификации `SKILL.md` и любые сопутствующие каталоги `references/` или `scripts/`.

## 3. Использование навыков в чате GitHub Copilot

После установки GitHub Copilot автоматически обнаруживает навыки:

1. Откройте чат Copilot в VS Code (`Ctrl+Alt+I` / `Cmd+Ctrl+I`).
2. Введите `/skills`, чтобы просмотреть загруженные навыки и их описания.
3. Вызовите любой навык Tendril напрямую в виде команды:
   - `/tendril-debug-plan <plan-id>`: Просмотр журналов выполнения, временной шкалы и верификаций для плана.
   - `/tendril-debug-job <job-id>`: Анализ артефактов задания, журналов агента и необработанных событий.
   - `/tendril-review`: Запуск комплексной проверки кода и тестов на регрессии для изменённых файлов.
   - `/tendrillable <url>`: Оценка задач GitHub на предмет выполнения автономным агентом.

## 4. Интеграция с другими расширениями ИИ для VS Code

Навыки Tendril соответствуют открытому стандарту навыков агентов и без проблем работают со сторонними расширениями для VS Code:

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
Навыки записываются в `.cline/skills/` или глобальный каталог конфигурации Cline.

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
Навыки устанавливаются в ваш каталог `.continue/skills/` и могут быть использованы в контексте промпта.

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
Устанавливаются в `.roo/skills/` для пользовательских системных режимов и выполнения задач.

## 5. Использование в связке с официальным расширением Ivy Tendril для VS Code

Для интегрированного рабочего процесса разработки установите официальное [расширение Ivy Tendril для VS Code](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril):

- **Панель планов (Plan Dashboard)**: Просматривайте, анализируйте и запускайте планы прямо из боковой панели.
- **Навигатор по рабочим деревьям (Worktree Navigator)**: Переходите в изолированные рабочие деревья выполнения в один клик.
- **Управление сервером (Server Control)**: Запускайте, останавливайте и проверяйте фоновые процессы сервера Tendril.

Сочетание навыков Tendril с расширением VS Code даёт вам полноценный центр управления для координации работы автономных кодинг-агентов.

## Лицензия

Навыки и плагины Tendril лицензируются на условиях [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) в корне репозитория.
