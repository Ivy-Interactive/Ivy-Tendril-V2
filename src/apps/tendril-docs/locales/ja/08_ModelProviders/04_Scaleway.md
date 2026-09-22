---
title: Scaleway
description: コーディング、推論、オープンウェイトモデル向けの OpenAI 互換 Generative API を提供する欧州のクラウドプロバイダー。
icon: Server
searchHints:
  - scaleway
  - eu
  - ヨーロッパ
  - generative apis
  - ソブリン
  - qwen
---

# Scaleway

[Scaleway](https://www.scaleway.com) は、フランス、オランダ、ポーランドに位置するエネルギー効率の高いデータセンターでホストされる主権 AI インフラを提供する、欧州の主要なクラウドサービスプロバイダーです。Generative APIs プラットフォームを通じて、Scaleway は主要なオープンモデル向けにフルマネージドで [OpenAI](https://openai.com) 互換のエンドポイントを提供しています。

## セットアップ

1. [scaleway.com](https://www.scaleway.com) でアカウントを作成します。
2. Scaleway コンソールの **Identity and Access Management (IAM)** で IAM API キー（シークレットキー）を発行します。
3. 同梱のサイドカーまたはターミナルから [OpenCode](https://opencode.ai) に接続します：
   ```bash
   opencode
   ```
   `/connect` と入力し、**Scaleway** を選択して、IAM シークレットキーを貼り付けます。
4. `/models` を使用してモデルを選択します。

## 推奨モデル

Scaleway はコード補完やソフトウェアエンジニアリング向けに最適化されたいくつかのモデルをホストしています：

| モデル                     | モデル ID                         | 提供元                               | 推奨ティア       |
| :------------------------- | :-------------------------------- | :----------------------------------- | :--------------- |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep             |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced         |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick            |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Reasoning) |

## Tendril での利用

### 方法 A: 同梱の OpenCode 経由

1. Tendril デスクトップアプリで **Settings > Coding Agent** に移動します。
2. アクティブなエージェントとして **OpenCode** を選択します（[OpenCode エージェント](../06_CodingAgents/04_OpenCode.md) を参照）。
3. OpenCode は、すべての計画実行タスクに対して設定された Scaleway 資格情報を使用します。

### 方法 B: `config.yaml` でのカスタム OpenAI エンドポイント

Scaleway の Generative API は `https://api.scaleway.ai/v1` で OpenAI 仕様に準拠しているため、`~/.tendril/config.yaml` 内で直接設定できます（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-scaleway-secret-key"
      OPENAI_BASE_URL: "https://api.scaleway.ai/v1"
    profiles:
      - name: deep
        model: "qwen2.5-coder-32b-instruct"
        effort: high
      - name: balanced
        model: "llama-3.3-70b-instruct"
        effort: medium
      - name: quick
        model: "mistral-small-24b-instruct-2501"
        effort: low
```

> [!NOTE]
> Scaleway は標準の HTTP Bearer トークン認証を採用しています。IAM シークレットキーがそのまま `OPENAI_API_KEY` として機能します。

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [Scaleway プラットフォーム](https://www.scaleway.com)
- [Scaleway コンソール](https://console.scaleway.com)
- [Scaleway Generative APIs ドキュメント](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
