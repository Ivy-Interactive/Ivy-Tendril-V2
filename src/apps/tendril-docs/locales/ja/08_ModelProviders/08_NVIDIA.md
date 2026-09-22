---
title: NVIDIA
description: NVIDIA Build 経由で NVIDIA NIM 推論マイクロサービスおよびコーディングタスク向けに高速化されたオープンモデルにアクセスします。
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

[NVIDIA Build](https://build.nvidia.com) は [NVIDIA](https://www.nvidia.com) NIM（推論マイクロサービス）エンドポイントへのアクセスを提供し、[Meta の Llama](https://llama.meta.com)、[DeepSeek](https://www.deepseek.com)、[Mistral AI](https://mistral.ai)、[Qwen](https://github.com/QwenLM) などの最先端オープンモデルに対して、エンタープライズ向けに最適化された GPU アクセラレーション推論を提供します。

## OpenCode 経由でのセットアップ

1. [build.nvidia.com](https://build.nvidia.com) で API キー（`nvapi-` で始まるもの）を発行します。
2. ターミナルまたは Tendril の組み込み PTY から [OpenCode](https://opencode.ai) に接続します：
   ```bash
   opencode
   ```
   `/connect` と入力し、**NVIDIA** を選択して、API キーを貼り付けます。
3. `/models` を使用してアクティブなモデルを切り替えます。

## 推奨モデル

NVIDIA NIM は主要なコーディングモデル向けに最適化されたビルドをホストしています：

| モデル                     | NIM 識別子                        | 実行ティア       | 提供元                               |
| :------------------------- | :-------------------------------- | :--------------- | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep             | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Reasoning) | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanced         | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Quick            | [Meta AI](https://llama.meta.com)    |

## Tendril での利用

### 方法 A: 同梱の OpenCode 経由

1. Tendril デスクトップアプリケーションで **Settings > Coding Agent** を開きます。
2. アクティブなコーディングエージェントとして **OpenCode** を選択します（[OpenCode エージェント](../06_CodingAgents/04_OpenCode.md) を参照）。
3. Tendril は、認証済みの NVIDIA NIM モデルを使用して、同梱の [OpenCode](https://opencode.ai) サイドカー経由で計画を実行します。

### 方法 B: `config.yaml` での直接 NIM API 設定

NVIDIA NIM は `https://integrate.api.nvidia.com/v1` で完全な [OpenAI](https://openai.com) 互換エンドポイントを提供しています。`~/.tendril/config.yaml` 内で直接接続するように設定できます（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "nvapi-..."
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1"
    profiles:
      - name: deep
        model: "meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "qwen/qwen2.5-coder-32b-instruct"
        effort: medium
      - name: quick
        model: "meta/llama-3.1-8b-instruct"
        effort: low
```

> [!TIP]
> NVIDIA NIM エンドポイントはトークンストリーミングが有効化された標準の OpenAI Chat Completion スキーマを使用しているため、Tendril のライブ出力ビューアと完全に互換性があります。

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [NVIDIA Build カタログ](https://build.nvidia.com)
- [NVIDIA NIM ドキュメント](https://build.nvidia.com/spark/cli-coding-agent)
