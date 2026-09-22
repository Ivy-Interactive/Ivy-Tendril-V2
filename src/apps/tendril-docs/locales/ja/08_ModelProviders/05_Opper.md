---
title: Opper.ai
description: EU データレジデンシーオプションを備え、Anthropic、OpenAI、Google、オープンウェイトプロバイダーなどの 300 以上のモデルへのアクセスを提供する AI ゲートウェイ。
icon: Server
searchHints:
  - opper
  - ゲートウェイ
  - eu
  - マルチプロバイダー
  - ルーター
---

# Opper.ai

[Opper.ai](https://opper.ai) は欧州に本社を置くエンタープライズ AI ゲートウェイであり、[Anthropic](https://www.anthropic.com)、[OpenAI](https://openai.com)、[Google AI](https://ai.google.dev)、[Mistral AI](https://mistral.ai)、およびオープンソースエコシステムの 300 以上の基底モデルへの統合アクセスを提供します。Opper は自動フォールバックルーティング、遅延の最適化、厳格な EU データレジデンシー制御を備えています。

## Opper CLI 経由でのセットアップ

1. Opper CLI をインストールします（[Node.js](https://nodejs.org) が必要）：
   ```bash
   npm i -g @opperai/cli
   ```
2. ブラウザ OAuth を使用してサインインします：
   ```bash
   opper login
   ```
3. Opper を通じて [OpenCode](https://opencode.ai) を起動します：
   ```bash
   opper launch opencode
   ```

認証は Opper CLI セッションによって管理されるため、個別のプロバイダー API キーは不要です。

## モデルの切り替え

起動時に `--model` フラグを使用してモデルを指定できます：

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

または、アクティブな OpenCode セッション中に対話形式で `/models` を使用してモデルを切り替えることも可能です。

## Tendril での利用

### 方法 A: 同梱の OpenCode 経由

1. Tendril デスクトップアプリケーションで **Settings > Coding Agent** に移動します。
2. アクティブなコーディングエージェントとして **OpenCode** を設定します（[OpenCode エージェント](../06_CodingAgents/04_OpenCode.md) を参照）。
3. Tendril は、Opper 経由でルーティングされた OpenCode を通じて実行をディスパッチします。

### 方法 B: `config.yaml` での直接ゲートウェイ設定

Opper は `https://api.opper.ai/v1` で OpenAI 互換ゲートウェイも公開しています。`~/.tendril/config.yaml` に Opper API キーを指定することで、Tendril を直接接続するように設定できます（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "opp_..."
      OPENAI_BASE_URL: "https://api.opper.ai/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: medium
```

> [!TIP]
> Opper ダッシュボードで EU レジデンシーポリシーが有効になっている場合、Opper はプロンプトプレフィックスを自動的にキャッシュし、クエリを欧州のデータリージョンにルーティングします。

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [Opper プラットフォーム](https://opper.ai)
- [Opper Agent CLI ドキュメント](https://opper.ai/agent-cli)
