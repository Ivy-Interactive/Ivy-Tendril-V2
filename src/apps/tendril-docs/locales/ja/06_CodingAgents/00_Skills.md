---
title: エージェントスキル
description: Tendril エージェントスキルは、Visual Studio Code、Claude Code、Antigravity、Cursor、OpenAI Codex、Gemini CLI にわたる自律型 AI コーディングエージェント向けのエンジニアリング、デバッグ、レビューのワークフローをパッケージ化します。
icon: Sparkles
searchHints:
  - スキル
  - エージェントスキル
  - プラグイン
  - copilot
  - claude
  - antigravity
  - cursor
  - codex
  - gemini
---

# エージェントスキル

## 概要

エージェントスキルはオープンエージェントスキル仕様に準拠しています。各スキルは、複雑なタスクを通じてコーディングエージェントを導く構造化された手順、リファレンスチェックリスト、および自動化スクリプトを提供します:

- `tendril-debug-plan`: [計画ログ](../02_Concepts/01_Plans.md)、JSONL セッション、検証実行、および障害モードを詳細に分析します。
- `tendril-debug-job`: [ジョブビュー](../04_Apps/04_Jobs.md) で生のエージェント実行成果物と [プロンプトウェア (promptware)](../02_Concepts/02_Promptwares.md) ログを分析します。
- `tendril-review`: 実装後の徹底的なコードレビュー、テストギャップ分析、およびクリーンアップチェックを実行します。
- `tendrillable`: [GitHub](../07_Integrations/01_Github.md) Issue を分類し、自律エージェントの実行準備状況を評価します。
- `tendril-release`: パッケージの更新、バージョニング、プルリクエスト、およびデプロイリリースを自動化します。
- `tendril-extension`: Ivy Tendril 拡張機能をビルド、テスト、パッケージ化し、[VS Code](https://code.visualstudio.com) および Antigravity IDE にリンクします。

## 共通インストール

ユニバーサル skills CLI を使用して、サポートされている任意のエージェントにスキルをインストールします:

```bash
# すべてのスキルをインストール
npx skills add ivy-interactive/ivy-tendril-v2

# 個別のスキルをインストール
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## エージェント連携

### Visual Studio Code ([GitHub Copilot](03_Copilot.md) & AI 拡張機能)

[VS Code](https://code.visualstudio.com) 内の [GitHub Copilot](https://github.com/features/copilot) を対象にスキルを直接インストールします:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

または、すべてのワークスペースにグローバルインストールします:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

スキルは `.agents/skills/`（または `~/.copilot/skills/`）に保存され、Copilot Chat の `/skills` メニューに表示されます。関連拡張機能を対象にすることも可能です:

- [Cline](https://github.com/cline/cline): `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev): `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code): `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

コンパニオンガイドの詳細については、[VS Code セットアップ](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md)を参照してください。

### [Claude Code](01_ClaudeCode.md)

[Claude Code](https://code.claude.com/docs) プラグインマーケットプレイス経由でインストールします:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

ローカルテストの場合は、チェックアウト先を指定して Claude Code を起動します:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

コンパニオンガイドの詳細については、[Claude Code セットアップ](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md)を参照してください。

### Google Antigravity

[Antigravity](https://antigravity.google) CLI（`agy`）を使用してインストールします:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

またはローカルチェックアウトから:

```bash
agy plugin install ./
```

コンパニオンガイドの詳細については、[Antigravity セットアップ](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md)を参照してください。

### [Cursor](https://cursor.com)

[Cursor](https://cursor.com) を対象にインストールします:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

またはスキルを `.cursor/skills/` に配置します。コンパニオンガイドの詳細については、[Cursor セットアップ](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md)を参照してください。

### [OpenAI Codex](02_Codex.md)

マーケットプレイスを追加し、[Codex](https://chatgpt.com/codex) にプラグインをインストールします:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

[Gemini CLI](https://github.com/google-gemini/gemini-cli) を使用して直接スキルをインストールします:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
