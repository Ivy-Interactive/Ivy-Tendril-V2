<p align="right">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <strong>Русский</strong> | <a href="README.hi.md">हिन्दी</a>
</p>

<h1>
  <a href="https://tendril.ivy.app"><img src="../../src/logo.png" alt="Логотип Tendril" width="64" valign="middle" /></a> Ivy Tendril
</h1>

<p>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/stargazers"><img src="https://img.shields.io/github/stars/Ivy-Interactive/Ivy-Tendril?style=flat&label=%E2%98%85" alt="Звёзды на GitHub" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest"><img src="https://img.shields.io/github/v/release/Ivy-Interactive/Ivy-Tendril?style=flat&label=release" alt="Последний релиз" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/actions/workflows/repo-health.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivy-Interactive/Ivy-Tendril/repo-health.yml?branch=development&style=flat&label=CI" alt="Статус CI" /></a>
  <a href="https://tendril.ivy.app"><img src="https://img.shields.io/badge/docs-tendril.ivy.app-blue?style=flat" alt="Документация" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Поддерживаемые платформы: macOS, Windows и Linux" />
</p>

<h2>Агентная фабрика ПО для 10x-разработчиков</h2>

<p>
ИИ-агенты уже способны писать 99 % кода. Это меняет само понятие «разработчик»: наша роль смещается к пониманию того, <strong>как выглядит хороший результат</strong>. Для этого нужны совершенно новые инструменты. Tendril — именно такой инструмент, и в эпоху агентов он заменяет вашу IDE.
</p>

<p>
<a href="https://youtu.be/_KVG1NnAj-8">
  <img src="../yt-thumbnail-in-two-minutes-2.png" alt="Ivy Tendril за две минуты: смотреть на YouTube" width="720">
</a>
</p>

<p>https://youtu.be/_KVG1NnAj-8</p>

## Возможности

<table>
<tr>
<td width="50%" valign="middle">

### Параллельные рабочие деревья (Parallel Worktrees)

Запускайте агентов в изолированных рабочих деревьях git. Ваша основная ветка остаётся чистой, пока вы не просмотрите, не одобрите и не объедините изменения.

[Документация &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/worktrees.gif" alt="Параллельные рабочие деревья" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Туннелирование (удалённая и мобильная разработка)

Безопасно откройте доступ к своему серверу через Cloudflare Quick Tunnels, чтобы наблюдать за работой агентов и направлять её откуда угодно.

[Документация &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/tunneling.gif" alt="Туннелирование" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Голосовой и расширенный ввод

Диктуйте промпты с помощью встроенного голосового ввода на Whisper и прикрепляйте текстовые файлы, логи или документы простым перетаскиванием.

[Документация &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/voice.gif" alt="Голосовой и расширенный ввод" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Аннотации к планам

Комментируйте черновики прямо в тексте, чтобы планы автоматически обновлялись с уточнёнными целями для агента.

[Документация &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/annotation.gif" alt="Аннотации к планам" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Полноценные код-ревью

Просматривайте изменения агента, изучайте диффы и одобряйте код с автоматическими проверками.

[Документация &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/review.gif" alt="Проведение код-ревью" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Интеграция с GitHub и автоматический «Входящие»

Принимайте GitHub Issues или баг-репорты jam.dev через веб-хуки, чтобы markdown-планы автоматически превращались в активные задания.

[Документация &rarr;](https://tendril.ivy.app/docs/integrations/jamdev)

</td>
<td width="50%">
  <img src="../../src/github.gif" alt="Интеграция с GitHub" width="100%" />
</td>
</tr>
</table>

---

## Поддерживаемые агенты

Работает с **любым CLI-агентом**: если он запускается в терминале, он работает и в Tendril.

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Логотип Claude Code" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Логотип Codex" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="Логотип GitHub Copilot" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://github.com/google-gemini/gemini-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Логотип Gemini" width="16" valign="middle" /> Gemini</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="Логотип OpenCode" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <kbd>+ любой CLI-агент</kbd>
</p>

## Навыки для агентов

Расширьте возможности своих ИИ-агентов официальными навыками Tendril для разработки и отладки.

### Быстрый старт

Установите навыки Tendril для любого поддерживаемого агента с помощью универсального установщика:

```bash
npx skills add ivy-interactive/ivy-tendril
```

Либо установите конкретный навык:

```bash
npx skills add ivy-interactive/ivy-tendril --skill tendril-debug-plan
```

### Поддерживаемые инструменты и окружения

<details>
<summary><strong>Visual Studio Code (GitHub Copilot и расширения)</strong></summary>

Установка навыков для GitHub Copilot в VS Code:

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot
```

Глобальная установка (для всех рабочих областей):

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot -g
```

Либо скопируйте навыки напрямую в `.agents/skills/` или `.github/skills/` (на уровне проекта) или в `~/.copilot/skills/` (глобально).

После установки навыки появятся в GitHub Copilot Chat в меню `/skills` и будут доступны как слэш-команды (например, `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`).

Сторонние агентные расширения для VS Code:
- Cline: `npx skills add ivy-interactive/ivy-tendril --agent cline`
- Continue: `npx skills add ivy-interactive/ivy-tendril --agent continue`
- Roo Code: `npx skills add ivy-interactive/ivy-tendril --agent roo`

Для полной интеграции с редактором установите официальное [расширение Ivy Tendril для VS Code](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) — оно даёт встроенные панели планов, навигацию по рабочим деревьям и отслеживание выполнения в реальном времени.

Подробные параметры настройки описаны в [руководстве по настройке VS Code](../vscode-setup.md).
</details>

<details>
<summary><strong>Claude Code</strong></summary>

Установка из маркетплейса Claude Code:

```
/plugin marketplace add ivy-interactive/ivy-tendril
/plugin install tendril-skills@ivy-tendril
```

Локальная разработка:

```bash
claude --plugin-dir /path/to/ivy-tendril
```

Подробные параметры настройки описаны в [руководстве по настройке Claude Code](../claude-setup.md).
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

Установка плагина по Git-URL:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril.git
```

Локальная установка:

```bash
agy plugin install ./
```

Подробные параметры настройки описаны в [руководстве по настройке Antigravity](../antigravity-setup.md).
</details>

<details>
<summary><strong>Cursor</strong></summary>

Установка для Cursor:

```bash
npx skills add ivy-interactive/ivy-tendril --agent cursor
```

Либо скопируйте навыки в `.cursor/skills/` (на уровне проекта) или `~/.cursor/skills/` (глобально).

Подробные параметры настройки описаны в [руководстве по настройке Cursor](../cursor-setup.md).
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Установка из маркетплейса плагинов Codex:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril
codex plugin add tendril-skills@tendril-skills
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Установка через Gemini CLI:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril.git --path skills
```
</details>

---

## Установка

Скачайте автономные установщики для настольных систем (`.pkg`, `.AppImage`, `.exe`) напрямую со страницы [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) или выполните одну из команд быстрой установки:

**macOS / Linux:**
```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows:**
```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

### Запуск

Tendril — это настольное приложение, но та же установка включает и CLI. Это два отдельных
исполняемых файла: `tendril-app` — настольное приложение, `tendril` — CLI и сервер.

Запустите настольное приложение, открыв **Tendril** из меню программ (или запустив исполняемый файл
`tendril-app` напрямую).

Запуск демона без графического интерфейса — HTTP и WebSocket API:
```bash
tendril run
```

`tendril run` сначала проверяет порт и выполняет миграции базы данных, а затем слушает на
`127.0.0.1:5010`. Изменить это можно флагами `--port` / `--host`; команда `tendril serve` поднимает
только слушатель без предварительных проверок (и именно она принимает `--tls-cert` / `--tls-key`).

Всё остальное — подкоманды: полный список выводит `tendril --help`, а `tendril doctor` сообщает о
состоянии установки (код выхода 0, если нет ни одного `[FAIL]`, иначе 1 — так его удобно использовать
в скриптах).

---

## 🏛 Структура каталогов

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   ├── tendril-app/            # Настольное приложение Tauri + фронтенд на React
│   │   └── tendril-docs/           # Сайт документации
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # Модели предметной области, база SQLite, движок рабочих деревьев
│   │   ├── tendril-server/         # HTTP-демон: REST и WebSocket на Axum
│   │   └── tendril-cli/            # Интерфейс командной строки («tendril»)
│   ├── extensions/
│   │   └── vscode/                 # Расширение для VS Code / Antigravity
│   ├── promptwares/                # Определения и прошивки promptware-агентов
│   ├── skills/                     # Навыки рабочих процессов агентов
│   └── scripts/                    # Скрипты настройки репозитория и проверки тестов
├── docs/                           # Содержимое документации
├── Cargo.toml                      # Единое рабочее пространство Cargo
├── pnpm-workspace.yaml             # Единое рабочее пространство pnpm
└── package.json                    # Скрипты корня рабочего пространства
```

---

## 🚀 Начало работы

### Требования
- [Rust](https://rustup.rs/) (edition 2021)
- [Node.js](https://nodejs.org/) (v22+) и [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### Быстрый старт

1. **Установите зависимости**:
   ```bash
   pnpm install
   ```

2. **Соберите компоненты и библиотеку интерфейса**:
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **Запустите Storybook**:
   ```bash
   pnpm dev:storybook
   ```

4. **Соберите и запустите настольное приложение**:
   ```bash
   pnpm dev:app
   ```

5. **Соберите крейты бэкенда**:
   ```bash
   cargo build --workspace
   ```

6. **Запустите тесты**:
   ```bash
   # Тесты веб-части и компонентов
   pnpm test

   # Тесты Rust
   cargo test --workspace
   ```

### Визуальное тестирование и скриншоты

Чтобы локально запустить проверки скриншотов и визуальные тесты Storybook:

```bash
pnpm install
pnpm run install:playwright:deps
```

---

## Сообщество и поддержка

- **Discord:** присоединяйтесь к сообществу в **[Discord](https://discord.gg/FHgxkDga3y)**.
- **Отзывы и идеи:** нашли ошибку или есть идея? [Создайте issue](https://github.com/Ivy-Interactive/Ivy-Tendril/issues).
- **Поддержите проект:** поставьте [звезду](https://github.com/Ivy-Interactive/Ivy-Tendril) репозиторию, чтобы следить за развитием.

---

## Лицензия

Tendril распространяется по модели source-available и лицензирован по [Functional Source License (FSL-1.1-ALv2)](../../LICENSE). Навыки и плагины для агентов (`skills/`, `.claude-plugin/`, `.codex-plugin/`, `.agents/`) также лицензированы по условиям корневого репозитория ([Functional Source License (FSL-1.1-ALv2)](../../LICENSE)).
