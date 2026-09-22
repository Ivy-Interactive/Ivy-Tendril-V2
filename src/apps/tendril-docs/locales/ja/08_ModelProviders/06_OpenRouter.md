---
title: OpenRouter
description: Anthropic、OpenAI、Google、xAI、Meta、DeepSeek などのモデルへのアクセスを提供する統合 API ゲートウェイ。
icon: Globe
searchHints:
  - openrouter
  - ルーター
  - マルチプロバイダー
  - ゲートウェイ
---

# OpenRouter

[OpenRouter](https://openrouter.ai) は、[Anthropic](https://www.anthropic.com)、[OpenAI](https://openai.com)、[Google DeepMind](https://deepmind.google)、[Meta AI](https://ai.meta.com)、[Mistral AI](https://mistral.ai)、[DeepSeek](https://www.deepseek.com)、[xAI](https://x.ai) などの何百もの最先端モデルへのアクセスを提供する、統一された [OpenAI](https://openai.com) 互換の API ゲートウェイです。OpenRouter は競争力のあるトークン単位の価格設定、自動プロバイダーフォールバック、および包括的な使用量メトリクスを提供します。

## OpenCode 経由でのセットアップ

1. [openrouter.ai/keys](https://openrouter.ai/keys) で API キーを作成します（キーは `sk-or-` で始まります）。
2. ターミナルまたは Tendril の組み込みターミナルから [OpenCode](https://opencode.ai) を起動します：
   ```bash
   opencode
   ```
   `/connect` と入力し、**OpenRouter** を選択して、API キーを貼り付けます。
3. `/models` を使用してアクティブなモデルを切り替えます。

### プロジェクト設定 (`opencode.json`)

`opencode.json` 内でプロジェクトレベルのデフォルトモデルを定義できます：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "~anthropic/claude-sonnet-5": {},
        "~google/gemini-3.8-flash": {},
        "~deepseek/deepseek-r1": {}
      }
    }
  }
}
```

## Tendril での利用

デスクトップ UI または `config.yaml` のいずれかを使用して、Tendril v2 を OpenRouter に直接接続できます。

### 方法 A: デスクトップ設定 (Bring Your Own LLM)

1. Tendril アプリで **Settings > Coding Agent** に移動します。
2. **Bring Your Own LLM** の下にある **OpenAI** カードをクリックします。
3. **Base URL** を `https://openrouter.ai/api/v1` に設定します。
4. OpenRouter のキー（`sk-or-...`）を **API Key** に入力し、**Save** をクリックします。

### 方法 B: `config.yaml` での手動設定

`~/.tendril/config.yaml` の `codingAgents` 配下に OpenRouter を設定します（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-or-..."
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: low
```

> [!TIP]
> OpenRouter のモデル ID にはベンダープレフィックスが含まれます（例: `anthropic/claude-opus-5` や `deepseek/deepseek-r1`）。これらのプレフィックスは、プロファイルの `model` フィールドにそのまま記載する必要があります。

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [OpenRouter プラットフォーム](https://openrouter.ai)
- [OpenRouter + OpenCode 統合ガイド](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
