---
title: Copilot
description: Copilot は、GitHub の Copilot CLI を利用した代替コーディングエージェントです。
icon: Bot
searchHints:
  - copilot
  - github
  - コーディングエージェント
---

# Copilot

## 設定

`config.yaml` で Copilot をコーディングエージェントとして設定します:

```yaml
codingAgent: copilot
```

または **Settings > Coding Agent** で選択します。

`config.yaml` の構造と設定の詳細については、[セットアップと設定](../03_Configuration/01_Setup.md)を参照してください。

## 前提条件

- [GitHub Copilot CLI](https://github.com/features/copilot) が PATH 上で `copilot` として利用可能である必要があります。公式スクリプトまたは [Homebrew](https://brew.sh) cask を使用してインストールします:
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # または: brew install --cask copilot-cli
  ```
  スタンドアロンの `copilot` バイナリが見つからない場合でも、[GitHub CLI](https://cli.github.com)（`gh`）がインストールされていれば、Tendril は自動的に `gh copilot` にフォールバックします。
- 有効な [GitHub Copilot](https://github.com/features/copilot) サブスクリプションが必要です。
- **認証**: Copilot には `login` CLI コマンドがなく、`gh auth login` と認証情報を共有しません。サインインするには:
  1. ターミナルで CLI を起動します: `copilot`
  2. プロンプトでスラッシュコマンドを実行します: `/login`
  3. ヘッドレス環境または無人の CI 環境では、`Copilot Requests` 権限を持つパーソナルアクセストークンを設定した `COPILOT_GITHUB_TOKEN`（または `GH_TOKEN`）環境変数を指定します。

## プロファイル

Tendril はエフォートレベルを Copilot にマッピングします:

| プロファイル | モデル  | エフォート | ユースケース             |
| ------------ | ------- | ---------- | ------------------------ |
| `deep`       | gpt-5.4 | high       | 複雑な複数ファイルの変更 |
| `balanced`   | gpt-5.4 | medium     | 標準的な計画の実行       |
| `quick`      | gpt-5.4 | low        | 単純な修正と小さな編集   |

プロファイルは[計画の複雑度レベル](../02_Concepts/01_Plans.md)に基づいて自動的に選択されるか、`config.yaml` 内の [プロンプトウェア](../02_Concepts/02_Promptwares.md) ごとに設定できます。

Tendril における Copilot のデフォルトモデルは `gpt-5.4` です。

### サポートされているモデル

GitHub Copilot は、ランタイムを通じて OpenAI と Anthropic の両方のモデルをサポートしています:

- **[OpenAI](https://openai.com) モデル**: `gpt-5.4`（デフォルト）、`gpt-5.4-mini`、`gpt-5.3-codex`、`gpt-5.2-codex`、`gpt-5.2`、`gpt-5-mini`、`gpt-4.1`（推論エフォート: `low`、`medium`、`high`、`xhigh`）。
- **[Anthropic Claude](https://code.claude.com/docs) モデル**: `claude-fable-5-1`、`claude-opus-5`、`claude-sonnet-5`、`claude-sonnet-4-6`、`claude-sonnet-4-5`、`claude-haiku-4-5`（推論エフォート: `low`、`medium`、`high`、`xhigh`、`max`）。

## GitHub Copilot 向け Tendril Skills のインストール

Tendril は、[Visual Studio Code](https://code.visualstudio.com) 内の GitHub Copilot 向けに、計画のデバッグ、ジョブ成果物の検査、コードレビュー、Issue のトリアージなどをカバーする専用スキルを提供しています。

### Skills CLI の使用

ワークスペースにスキルをインストールします:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

または、すべてのワークスペースにグローバルインストールします:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### `.agents/skills/` への手動配置

スキルは、`.agents/skills/`、`.github/skills/`、または `~/.copilot/skills/` ディレクトリに直接配置することもできます:

```bash
mkdir -p .agents/skills
cp -r /path/to/skills/* .agents/skills/
```

インストールが完了すると、スキルは GitHub Copilot Chat の `/skills` メニューに表示され、スラッシュコマンド（例: `/tendril-debug-plan`、`/tendril-review`）として直接呼び出すことができます。

詳細については、[エージェントスキル](00_Skills.md)を参照してください。
