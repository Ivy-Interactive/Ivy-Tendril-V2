---
title: Claude Code
description: Claude Code は、Anthropic の Claude モデルを搭載した Tendril のデフォルトのコーディングエージェントです。
icon: Bot
searchHints:
  - claude
  - claude code
  - anthropic
  - コーディングエージェント
  - ai エージェント
---

# Claude Code

## 設定

`config.yaml` で Claude Code をコーディングエージェントとして設定します:

```yaml
codingAgent: claude
```

または **Settings > Coding Agent** で選択します。

`config.yaml` の構造と設定の詳細については、[セットアップと設定](../03_Configuration/01_Setup.md)を参照してください。

## 前提条件

- [Claude Code](https://code.claude.com/docs) CLI がインストールされ、PATH 上で `claude` として利用可能である必要があります。ネイティブインストーラーまたは [Homebrew](https://brew.sh) cask を使用してください:
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # または: brew install --cask claude-code
  ```
- Tendril を使用する前に、`claude auth login`（または `claude login`）を実行して認証します。Claude Code には [Anthropic](https://www.anthropic.com) の Pro、Max、Team、Enterprise、または [Console](https://console.anthropic.com) プランが必要です（claude.ai の無料プランには CLI アクセスは含まれません）。
- ヘッドレス環境または代替バックエンドを使用する場合は、`ANTHROPIC_API_KEY` を設定するか、[AWS Bedrock](https://aws.amazon.com/bedrock/)（`CLAUDE_CODE_USE_BEDROCK=1`）または [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai)（`CLAUDE_CODE_USE_VERTEX=1`）を設定します。

## プロファイル

Tendril はエフォートレベルを Claude モデルにマッピングします:

| プロファイル | モデル | エフォート | ユースケース                                 |
| ------------ | ------ | ---------- | -------------------------------------------- |
| `deep`       | opus   | max        | 複雑な複数ファイルの変更、アーキテクチャ設計 |
| `balanced`   | sonnet | high       | 標準的な計画の実行、大部分のタスク           |
| `quick`      | haiku  | low        | 単純な修正、フォーマット調整、小さな編集     |

プロファイルは[計画の複雑度レベル](../02_Concepts/01_Plans.md)に基づいて自動的に選択されるか、`config.yaml` 内の [プロンプトウェア](../02_Concepts/02_Promptwares.md) ごとに設定できます。

## 利用可能なモデル

| モデル           | ID                 | コンテキストウィンドウ | 料金（MTok あたりの入力 / 出力） |
| ---------------- | ------------------ | ---------------------- | -------------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M                     | $10.00 / $50.00                  |
| Claude Opus 5    | `claude-opus-5`    | 1M                     | $5.00 / $25.00                   |
| Claude Opus      | `opus`             | 1M                     | $5.00 / $25.00                   |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M                     | $2.00 / $10.00                   |
| Claude Sonnet    | `sonnet`           | 1M                     | $2.00 / $10.00                   |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k                   | $1.00 / $5.00                    |
| Claude Haiku     | `haiku`            | 200k                   | $1.00 / $5.00                    |

`opus`、`sonnet`、`haiku` は、そのティアにおける Anthropic の最新モデルを追跡する Claude Code のエイリアスです。一方、`claude-opus-5`（カタログのデフォルト）と `claude-fable-5-1` は固定された ID です。

Claude Sonnet の導入特別価格（$2.00 / $10.00）は 2026-08-31 まで適用され、その後は標準価格の $3.00 / $15.00 が適用されます。

## Tendril Skills プラグイン

公式の Tendril エンジニアリングおよびデバッグスキルを Claude Code プラグインとしてインストールできます:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

ローカルでの開発およびテスト中は、チェックアウト先から直接スキルを読み込みます:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

詳細については、[エージェントスキル](00_Skills.md)を参照してください。
