# Руководство по настройке Google Antigravity для Tendril Skills

В этом руководстве описывается установка и использование навыков Tendril (Tendril skills) с помощью Google Antigravity CLI (`agy`) и Antigravity IDE.

## 1. Установка через Antigravity CLI

Tendril предоставляет манифест плагина Antigravity в `.agents/plugins/marketplace.json`.

### Установка из удалённого репозитория Git
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### Установка из локального клона репозитория
Во время локальной разработки или внутри клона Ivy-Tendril-V2:
```bash
agy plugin install ./
```

## 2. Верификация и обнаружение плагина

Убедитесь, что плагин и связанные с ним навыки успешно загружены:

```bash
# Список установленных плагинов
agy plugin list

# Проверка доступных навыков
agy skill list
```

Вы увидите встроенные навыки Tendril:
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. Вызов навыков в Antigravity

В любой интерактивной сессии агента Antigravity или автоматизированном скрипте:

- Попросить Antigravity отладить план:
  ```
  Use tendril-debug-plan to investigate plan 00516
  ```
- Просмотреть ожидающие диффы рабочего дерева (worktree):
  ```
  Run tendril-review on the current changes
  ```
- Провести триаж задач бэклога:
  ```
  Run tendrillable on https://github.com/ivy-interactive/ivy-tendril-v2 5
  ```

## 4. Интеграция с Antigravity IDE

При работе в Antigravity IDE:
1. Навыки, размещённые в корневом каталоге `.agents/skills/` вашей рабочей области, индексируются автоматически.
2. Чтобы связать расширение Ivy Tendril с Antigravity IDE:
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. Перезагрузите окно Antigravity IDE (`Cmd+Shift+P` -> `Developer: Reload Window`).

## Лицензия

Навыки и плагины Tendril лицензируются на условиях [Functional Source License (FSL-1.1-ALv2)](../LICENSE) в корне репозитория.
