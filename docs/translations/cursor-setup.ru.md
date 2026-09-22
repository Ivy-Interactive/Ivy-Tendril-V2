# Руководство по настройке Cursor для Tendril Skills

В этом руководстве объясняется, как установить и настроить навыки агентов Tendril (Agent Skills) в Cursor.

## 1. Быстрая установка (Skills CLI)

Установите навыки Tendril в свой проект Cursor с помощью интерфейса командной строки skills CLI:

```bash
# Установка на уровне проекта (устанавливается в .cursor/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# Глобальная установка (для всех рабочих пространств Cursor)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Структура каталогов в Cursor

Cursor выполняет поиск определений навыков в следующих расположениях:

- **Уровень проекта**: `.cursor/skills/<skill-name>/SKILL.md`
- **Глобальный уровень / уровень пользователя**: `~/.cursor/skills/<skill-name>/SKILL.md` (macOS/Linux) или `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md` (Windows)

Каждая папка содержит:
- `SKILL.md`: Основные инструкции с метаданными YAML frontmatter
- Вспомогательную справочную документацию и скрипты

## 3. Взаимодействие с правилами Cursor (.cursorrules)

Вы можете ссылаться на навыки Tendril из файлов `.cursorrules` или `.cursor/rules/*.mdc` вашего проекта:

```markdown
When debugging failed plans or reviewing changes:
- Reference src/skills/tendril-debug-plan for plan execution diagnosis.
- Run src/skills/tendril-review procedures before finalizing pull requests.
```

## 4. Использование в чате агента Cursor

В окне чата агента Cursor:
- Введите `@tendril-debug-plan` или попросите агента изучить план, следуя его инструкциям.
- Попросите Cursor выполнить `/tendril-review` для активного git diff.
- Запустите `/tendrillable`, чтобы ранжировать задачи по их пригодности для выполнения агентом.

## Лицензия

Навыки и плагины Tendril лицензируются на условиях [Functional Source License (FSL-1.1-ALv2)](../LICENSE) в корне репозитория.
