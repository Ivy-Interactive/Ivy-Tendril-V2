---
title: Vercel AI Gateway
description: Vercel の AI Gateway を通じてリクエストをルーティングし、OpenAI、Anthropic、Google、オープンウェイトモデルへの統合アクセスと組み込みの可観測性を実現します。
icon: Zap
searchHints:
  - vercel
  - ai gateway
  - 統合
  - 可観測性
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) は、[Anthropic](https://www.anthropic.com)、[OpenAI](https://openai.com)、[Google AI](https://ai.google.dev)、[xAI](https://x.ai) を含む主要なモデルプロバイダー間で推論リクエストをルーティングするための統合プロキシを提供します。集中型の API キー管理、エッジキャッシング、リアルタイムテレメトリ、およびレート制限ガードレールを備えています。

## OpenCode 経由でのセットアップ

1. [Vercel ダッシュボード](https://vercel.com) のチームの **AI Gateway > API keys** で API キーを作成します。
2. ターミナルまたは Tendril の組み込み PTY から [OpenCode](https://opencode.ai) に接続します：
   ```bash
   opencode
   ```
   `/connect` と入力し、**Vercel AI Gateway** を検索して、API キーを入力します。
3. `/models` を使用してアクティブなモデルを切り替えます。

### ルーティングルール (`opencode.json`)

フェイルオーバーの順序とルーティング設定を `opencode.json` 内で直接定義できます：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "vercel": {
      "models": {
        "anthropic/claude-sonnet-5": {
          "options": {
            "order": ["anthropic", "vertex"]
          }
        }
      }
    }
  }
}
```

## Tendril での利用

### 方法 A: 同梱の OpenCode 経由

1. Tendril デスクトップアプリケーションで **Settings > Coding Agent** に移動します。
2. アクティブなエージェントとして **OpenCode** を選択します（[OpenCode エージェント](../06_CodingAgents/04_OpenCode.md) を参照）。
3. Tendril は、Vercel AI Gateway に接続された同梱の [OpenCode](https://opencode.ai) サイドカーを通じてすべての計画実行をルーティングします。

### 方法 B: `config.yaml` での直接ゲートウェイ設定

Vercel AI Gateway は `https://ai-gateway.vercel.sh/v1` で [OpenAI](https://openai.com) 互換の API エンドポイントを提供しています。`~/.tendril/config.yaml` 内で直接ルーティングするように Tendril を設定できます（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-vercel-ai-key"
      OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1"
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

## モニタリングとテレメトリ

使用状況メトリクス、トークン消費量、および遅延の内訳は、Vercel ダッシュボードの **AI Gateway > Analytics** 配下に自動的に記録され、Tendril のローカルトークン台帳を補完します。

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [Vercel AI Gateway ドキュメント](https://vercel.com/docs/ai-gateway)
- [Vercel + OpenCode ガイド](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
