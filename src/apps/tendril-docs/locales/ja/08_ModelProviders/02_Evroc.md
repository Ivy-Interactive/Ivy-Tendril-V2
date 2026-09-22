---
title: Evroc
description: Kimi、Llama、Mistral などのオープンソースコーディングモデルを提供する欧州のソブリンクラウドプロバイダー。
icon: Server
searchHints:
  - evroc
  - eu
  - ヨーロッパ
  - ソブリン
  - kimi
  - mistral
  - llama
---

# Evroc

[Evroc](https://cloud.evroc.com) は、欧州全域で安全で環境に配慮したデータセンターを運営する欧州のソブリンクラウドプロバイダーです。「Think」AI プラットフォームを通じ、Evroc は完全な [GDPR](https://gdpr.eu) 準拠と欧州のデータ主権を備え、Kimi、Llama、Mistral などの主要なオープンソースモデル向けに [OpenAI](https://openai.com) 互換の推論サービスを提供しています。

## セットアップ

1. [cloud.evroc.com](https://cloud.evroc.com) でアカウントを作成します。
2. Evroc コンソールの **Think > Models > + New** で API キーを発行します。
3. 同梱のサイドカーまたはターミナルから [OpenCode](https://opencode.ai) に接続します：
   ```bash
   opencode
   ```
   `/connect` と入力し、**evroc** を選択して、API キーを入力します。
4. `/models` でアクティブなモデルを選択します。

## 推奨モデル

Evroc はコーディングと技術的な推論に最適化された高性能なオープンウェイトをホストしています：

| モデル                    | ID                                                                          | 提供元                             | 強み                                                       |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :--------------------------------------------------------- |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | 優れた長文コンテキスト処理と複数ファイルにわたる推論       |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | 高速かつ正確なコード生成と検証                             |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | 幅広いコーディング知識、ドキュメント作成、リファクタリング |

> [!TIP]
> プログラミングタスクで最良の結果を得るには、Evroc コンソールで **Code** タグが付いているモデルを探してください。

## Tendril での利用

Tendril v2 の計画実行を Evroc 経由でルーティングするには、次の 2 つの方法があります：

### 方法 A: 同梱の OpenCode 経由

1. Tendril デスクトップアプリで **Settings > Coding Agent** に移動します。
2. コーディングエージェントとして **OpenCode** を選択します（[OpenCode エージェント](../06_CodingAgents/04_OpenCode.md) を参照）。
3. Tendril は同梱の [OpenCode](https://opencode.ai) サイドカー（`binaries/opencode`）を呼び出し、認証済みの Evroc プロバイダー経由でリクエストをルーティングします。

### 方法 B: `config.yaml` でのカスタム OpenAI エンドポイント

Evroc は OpenAI 互換インターフェースを提供しているため、`~/.tendril/config.yaml` の `codingAgents` 配下に直接設定できます（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-evroc-api-key"
      OPENAI_BASE_URL: "https://api.evroc.com/v1"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: balanced
        model: "moonshotai/Kimi-K2.5"
        effort: medium
      - name: quick
        model: "mistralai/Mistral-Small-24B-Instruct-2501"
        effort: low
```

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [Evroc Cloud コンソール](https://cloud.evroc.com)
- [Evroc + OpenCode ドキュメント](https://docs.evroc.com/integrations/opencode.html)
