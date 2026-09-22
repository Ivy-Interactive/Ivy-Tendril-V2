---
title: Установка
description: Установите Tendril с помощью готовых бинарных файлов или соберите из исходного кода, запустите десктопное приложение и CLI, а также настройте окружение.
icon: Download
searchHints:
  - установка
  - готовые бинарные файлы
  - сборка из исходного кода
  - предварительные требования
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - обновление
---

# Установка

Tendril можно установить с помощью готовых десктопных пакетов и бинарных файлов CLI либо собрать локально из исходного кода.

## Быстрая установка

Загрузите автономные установщики десктопного приложения (`.dmg`, `.pkg`, `.exe`, `.AppImage`, `.deb`) непосредственно со страницы
[GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) или запустите один из автоматических скриптов установки:

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

Программа установки поместит бинарный файл CLI `tendril` в ваш `PATH` и зарегистрирует десктопное приложение в системном меню.

## Предварительные требования (для сборки из исходного кода)

При сборке из исходного кода убедитесь, что следующие зависимости установлены и доступны в вашем `PATH`:

| Инструмент                                   | Версия                | Назначение                                                                                      |
| -------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (редакция 2021) | Компилирует нативный CLI, серверный демон и ядро.                                               |
| [Node.js](https://nodejs.org/)               | 22 или новее          | Обеспечивает работу инструментов фронтенда и скриптов сборки.                                   |
| [pnpm](https://pnpm.io/)                     | 11 или новее          | Управляет пакетами рабочей области и зависимостями.                                             |
| [Vite+](https://viteplus.dev/) (`vp`)        | актуальная            | Координирует сборку, линтинг, форматирование и тестирование.                                    |
| [Git](https://git-scm.com/)                  | 2.30+                 | Управляет [рабочими деревьями Git](https://git-scm.com/docs/git-worktree), коммитами и ветками. |
| [GitHub CLI](https://cli.github.com/) (`gh`) | авторизован           | Автоматически открывает pull request и управляет задачами.                                      |

Вам также потребуется как минимум один авторизованный CLI кодинг-агента (например, [Claude Code](https://code.claude.com/docs),
[GitHub Copilot](https://github.com/features/copilot), [Gemini](https://ai.google.dev),
[OpenCode](https://opencode.ai), [Antigravity](https://github.com/google-deepmind) или
[Cursor](https://www.cursor.com)). В разделе [Подключение кодовой базы](03_Onboarding.md) настройка агентов описана подробно.

## Сборка из исходного кода

Клонируйте репозиторий и установите зависимости рабочей области:

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # общая библиотека UI, необходимая для десктопного приложения
node src/scripts/ensure-wireframe-payload.mjs      # подготавливает ресурсы вайрфреймов для нативной сборки
cargo build --workspace                            # собирает tendril-core, tendril-server, tendril-cli
```

> [!NOTE]
> Библиотека `@ivy-interactive/components` и ресурсы вайрфреймов должны быть сгенерированы перед компиляцией
> нативных крейтов рабочей области, поскольку `tendril-app` и `tendril-wireframe` импортируют эти ресурсы во время сборки.

## Запуск десктопного приложения

Для локальной разработки с поддержкой горячей перезагрузки модулей (HMR):

```bash
pnpm dev:desktop
```

Эта команда собирает необходимые бинарные файлы sidecar и запускает Vite вместе с
нативным окном [Tauri 2](https://tauri.app). Десктопное приложение автоматически управляет
фоновым демоном (`tendril run`).

### Сборка автономного релиза

Чтобы упаковать автономный пакет релиза для вашей платформы:

```bash
cargo build --release --bin tendril

# Подготовка нативного CLI-сайдкара для вашей целевой архитектуры
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# Получение встроенного агента OpenCode sidecar
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# Сборка пакета установщика (DMG для macOS, NSIS/MSI для Windows, AppImage/deb для Linux)
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## Установка CLI

Бинарный файл `tendril` служит одновременно интерфейсом командной строки и сервером демона:

```bash
cargo build --release --bin tendril
# или установка непосредственно в ~/.cargo/bin:
cargo install --path src/crates/tendril-cli
```

Проверьте корректность установки с помощью команды диагностики:

```bash
tendril version
tendril doctor
```

`tendril doctor` проверяет переменную `$TENDRIL_HOME`, синтаксис `config.yaml`, базу данных [SQLite](https://www.sqlite.org),
каталог планов, а также учётные данные `git` и `gh`.

### Запуск демона в автономном (headless) режиме

Чтобы запустить Tendril в качестве автономного серверного демона без пользовательского интерфейса:

```bash
# Рекомендуется: проверяет доступность порта и применяет ожидающие миграции БД
tendril run

# Или прямой слушатель (поддерживает флаги --tls-cert и --tls-key)
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> Сервер по умолчанию слушает адрес `127.0.0.1:5010`, предоставляя эндпоинты REST и WebSocket. Он не
> раздаёт статический веб-интерфейс; взаимодействуйте с ним через десктопное приложение или CLI.

## Конфигурация и структура каталогов

Всё состояние среды выполнения Tendril хранится внутри `$TENDRIL_HOME`, который определяется в следующем приоритете:

1. Переменная окружения `TENDRIL_HOME`;
2. Путь, записанный в `~/.tendril_location` (если файл существует);
3. Стандартное пользовательское расположение: `~/.tendril`.

Внутри каталога `$TENDRIL_HOME`:

```
~/.tendril/
├── config.yaml     # кодинг-агент, определения проектов, верификации, переопределения промптваров
├── tendril.db      # база данных SQLite для заданий, расходов и телеметрии выполнения
├── Plans/          # структурированные планы и их изолированные рабочие деревья git
├── Jobs/           # логи выполнения, промпты агентов и записи необработанных транскриптов
└── Promptwares/    # развёрнутые определения агентов рабочих процессов
```

Минимальный пример файла `config.yaml`:

```yaml
codingAgent: claude
maxConcurrentJobs: 20

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

Разверните стандартные промптвары для инициализации определений агентов:

```bash
tendril promptware deploy
```

> [!WARNING]
> Убедитесь, что CLI выбранного кодинг-агента авторизован перед запуском первого задания. Если агент
> приостановит работу для запроса учётных данных в фоновом процессе, задание заблокируется или завершится по таймауту.

## Обновление

Если Tendril установлен через установочный скрипт, повторно выполните команду установки в одну строку, чтобы загрузить последний релиз.

При работе с клоном из исходного кода:

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## Следующие шаги

- [Подключение кодовой базы](03_Onboarding.md) — настройка предварительных требований репозитория и проверка доступа агента.
- [Концепции: Планы](../02_Concepts/01_Plans.md) — структура планов и жизненный цикл проверки.
- [Устранение неполадок](06_Troubleshooting.md) — решения распространённых ошибок сборки и выполнения.
