---
title: OpenCode
description: OpenCode は、統一された CLI を介して複数のモデルプロバイダーをサポートする代替コーディングエージェントです。
icon: Cpu
searchHints:
  - opencode
  - open code
  - コーディングエージェント
---

# OpenCode

## 設定

`config.yaml` で OpenCode をコーディングエージェントとして設定します:

```yaml
codingAgent: opencode
```

または **Settings > Coding Agent** で選択します。

`config.yaml` の構造と設定の詳細については、[セットアップと設定](../03_Configuration/01_Setup.md)を参照してください。

## 前提条件

- **バンドルされたサイドカー**: Tendril は [OpenCode](https://opencode.ai) をデスクトップアプリにバンドルされたサイドカーとして同梱しており、PATH 上のバージョンよりも自動的に優先します。新規セットアップ時の手動インストールは不要です。
- **スタンドアロンインストール**（任意）: スタンドアロン版をインストールまたは実行する場合:
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **認証**: `opencode providers login`（または `opencode auth login`）を実行して、選択したプロバイダー（例: [Anthropic](https://www.anthropic.com)、[OpenAI](https://openai.com)、[Google AI](https://ai.google.dev)、[Groq](https://groq.com)）で認証します。

## プロファイル

Tendril はエフォートレベルを OpenCode モデルにマッピングします:

| プロファイル | モデル  | エフォート | ユースケース             |
| ------------ | ------- | ---------- | ------------------------ |
| `deep`       | default | high       | 複雑な複数ファイルの変更 |
| `balanced`   | default | medium     | 標準的な計画の実行       |
| `quick`      | default | low        | 単純な修正と小さな編集   |

エフォートレベルは、OpenCode の `--variant` フラグ（`low`、`medium`、`high`、`max`）に直接マッピングされます。

カタログのデフォルトモデルは `moonshotai/Kimi-K3` です。OpenCode は、`claude-fable-5-1`、`claude-opus-5`、`claude-opus-4-7`、`claude-sonnet-5`、`claude-sonnet-4-6`、`gpt-5.5` などの固定された Anthropic および OpenAI モデルもサポートしています。

## Bring-Your-Own LLM とプロバイダー

OpenCode は、**Settings > Coding Agent** における Tendril の **Bring-Your-Own LLM** カードを駆動します:

- **[OpenAI](https://openai.com)**: お手元の `OPENAI_API_KEY` を使用して OpenCode を `https://api.openai.com` に接続します。
- **[Anthropic](https://www.anthropic.com)**: お手元の `ANTHROPIC_API_KEY` を使用して OpenCode を `https://api.anthropic.com/v1` に接続します。
- **[Berget AI](../08_ModelProviders/01_Berget.md)**: [Berget AI](https://berget.ai) API キーを使用して OpenCode を `https://api.berget.ai/v1` に接続します。
- **カスタムエンドポイント**: OpenAI 互換または Anthropic 互換のリバースプロキシ向けに、カスタムベース URL とキーを設定します。その他のプロバイダーについては、[モデルプロバイダー](../08_ModelProviders/_Index.md)を参照してください。

Tendril は `OPENCODE_CONFIG_CONTENT` を使用してこれらのプロバイダーを非破壊的に構成するため、グローバルの `opencode.json` 設定が上書きされることはありません。

## ローカル [Ollama](https://ollama.com) のセットアップ

ローカルの [Ollama](https://ollama.com) モデルで OpenCode を実行する場合は、`config.yaml` でサーバー URL を直接指定します:

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
