---
title: Gemini CLI
description: Gemini CLI は、Google の Gemini モデルを搭載したコーディングエージェントです。
icon: Sparkles
searchHints:
  - gemini
  - google
  - コーディングエージェント
---

# Gemini CLI

## 設定

`config.yaml` で Gemini をコーディングエージェントとして設定します:

```yaml
codingAgent: gemini
```

または **Settings > Coding Agent** で選択します。

`config.yaml` の構造と設定の詳細については、[セットアップと設定](../03_Configuration/01_Setup.md)を参照してください。

## 前提条件

- [Homebrew](https://brew.sh) または [MacPorts](https://www.macports.org) 経由で `gemini` バイナリをインストールします:
  ```bash
  brew install gemini-cli
  # または: sudo port install gemini-cli
  ```
- **認証**: `gemini auth` CLI サブコマンドは存在しないことに注意してください。認証を行うには:
  - 初回実行時、`gemini` はブラウザの OAuth 経由で **Sign in with Google** を求めるプロンプトを表示します。
  - アクティブな CLI セッション内では、`/auth` スラッシュコマンド（または `/auth login`）を使用して再認証またはアカウントの切り替えを行います。
  - ヘッドレス環境または CI 環境では、[Google AI Studio](https://aistudio.google.com/apikey) で生成された `GEMINI_API_KEY` 環境変数を設定します。

## プロファイル

Tendril は Gemini プロファイルを以下のデフォルトにマッピングします:

| プロファイル | モデル           | ユースケース             |
| ------------ | ---------------- | ------------------------ |
| `deep`       | gemini-3.8-flash | 複雑な複数ファイルの変更 |
| `balanced`   | gemini-3.8-flash | 標準的な計画の実行       |
| `quick`      | gemini-3.8-flash | 単純な修正と小さな編集   |

プロファイルは[計画の複雑度レベル](../02_Concepts/01_Plans.md)に基づいて自動的に選択されるか、`config.yaml` 内の [プロンプトウェア](../02_Concepts/02_Promptwares.md) ごとに設定できます。Gemini CLI は推論エフォートフラグを使用しません。

Tendril における Gemini のデフォルトモデルは `gemini-3.8-flash` です。

## 利用可能なモデル

Tendril の Gemini カタログには以下が含まれます:

- `gemini-3.8-flash`（デフォルト）: 次世代の高速かつ高機能な推論、1M コンテキストウィンドウ
- `gemini-3.7-flash`: 高速で有能な推論、1M コンテキストウィンドウ
- `gemini-3.6-flash`: マルチモーダル推論、1M コンテキストウィンドウ
- `gemini-3.1-pro`: 複雑なアーキテクチャ向けの高度な推論、1M コンテキストウィンドウ
- `gemini-3-pro-preview`: 次世代推論プレビュー
- `gemini-3-flash-preview`: 次世代高速プレビュー

`config.yaml` でモデルをオーバーライドします:

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## 実行とフラグ

Tendril は以下を使用して Gemini CLI を起動します:

- 非対話型モード: `--output-format stream-json --skip-trust --approval-mode <mode>`（ここで `FullAuto` は `yolo`、`AcceptEdits` は `auto_edit`、`Plan` は `plan` を渡します）、およびサンドボックスモードが有効な場合は `--sandbox`。
- 対話型エージェントターミナル: `gemini --yolo --skip-trust -i "<prompt>"`。
