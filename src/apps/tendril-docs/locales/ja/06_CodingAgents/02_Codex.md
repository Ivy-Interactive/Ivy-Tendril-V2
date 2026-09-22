---
title: Codex
description: Codex は、OpenAI の GPT モデルを搭載した代替コーディングエージェントです。
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - コーディングエージェント
---

# Codex

## 設定

`config.yaml` で Codex をコーディングエージェントとして設定します:

```yaml
codingAgent: codex
```

または **Settings > Coding Agent** で選択します。

`config.yaml` の構造と設定の詳細については、[セットアップと設定](../03_Configuration/01_Setup.md)を参照してください。

## 前提条件

- [Codex](https://chatgpt.com/codex) CLI がインストールされ、PATH 上で `codex` として利用可能である必要があります。公式スクリプトまたは [Homebrew](https://brew.sh) cask を使用してインストールします:
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # または: brew install --cask codex
  ```
- Tendril を使用する前に、以下を実行して認証します:
  ```bash
  codex login
  ```
  ヘッドレス環境または無人環境では、stdin 経由で [OpenAI platform API キー](https://platform.openai.com/api-keys) を渡します:
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## プロファイル

Tendril はエフォートレベルを Codex モデルにマッピングします:

| プロファイル | モデル        | エフォート | ユースケース             |
| ------------ | ------------- | ---------- | ------------------------ |
| `deep`       | gpt-5.6-sol   | high       | 複雑な複数ファイルの変更 |
| `balanced`   | gpt-5.6-terra | medium     | 標準的な計画の実行       |
| `quick`      | gpt-5.6-luna  | low        | 単純な修正と小さな編集   |

プロファイルは[計画の複雑度レベル](../02_Concepts/01_Plans.md)に基づいて自動的に選択されるか、`config.yaml` 内の [プロンプトウェア](../02_Concepts/02_Promptwares.md) ごとに設定できます。

Tendril における Codex のデフォルトモデルは `gpt-5.6-terra` です。

### サポートされているモデルと推論エフォート

Codex カタログは以下の [OpenAI](https://openai.com) モデルをサポートしています:

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra`（デフォルト）
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

Codex は 5 段階の推論エフォートレベル（`none`、`low`、`medium`、`high`、`xhigh`）をサポートしています。`none` レベルを使用すると、推論のオーバーヘッドなしで Codex を実行し、迅速な編集を行うことができます。

## 実行とサンドボックス

Tendril は非対話型モードで `codex exec` を介して Codex を起動します:

- サンドボックスはデフォルトで `--sandbox workspace-write` に設定され、ネットワークアクセスが有効になります。プロジェクトのセキュリティ設定でサンドボックスモードが無効になっている場合、Tendril は `danger-full-access` を渡します。
- セキュリティルールからの追加の許可パスは `--add-dir` 経由で指定されます。
- 設定された [MCP (Model Context Protocol)](https://modelcontextprotocol.io) サーバーは一時的な JSON 設定に書き出され、`--mcp-config` 経由で指定されます。
