---
title: Cloudflare
description: Cloudflare Workers AI をモデルプロバイダーとして使用し、Workers の構築とデプロイのための Cloudflare MCP サーバーに接続します。
icon: Globe
searchHints:
  - cloudflare
  - workers ai
  - cf
  - エッジ
  - cloudflared
  - トンネル
---

# Cloudflare

[Cloudflare](https://www.cloudflare.com) は、[Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) を通じてグローバルなエッジコンピューティングとサーバーレス AI 推論を提供します。開発者はエッジ上で高速かつコスト効率の高いオープンウェイトモデル（[Meta の Llama](https://llama.meta.com) など）を実行しながら、フルスタックの [Cloudflare Workers](https://workers.cloudflare.com) 開発用の公式 Cloudflare [Model Context Protocol (MCP)](../09_Advanced/03_MCP.md) スキルと組み合わせることができます。

## OpenCode 経由でのセットアップ

1. ターミナルまたは Tendril の組み込み PTY から [OpenCode](https://opencode.ai) を起動します：
   ```bash
   opencode
   ```
   `/connect` と入力し、**Cloudflare** を選択します。
2. プロンプトが表示されたら、ブラウザでの認証を完了します。
3. `/models` でアクティブなモデルを選択します。

## Cloudflare MCP スキル（オプション）

Cloudflare MCP サーバーを追加して、Cloudflare Workers、KV、D1 データベース、デプロイに対する直接の制御権を [コーディングエージェント](../06_CodingAgents/_Index.md) に付与できます（[スキル](../06_CodingAgents/00_Skills.md) を参照）：

```bash
npx skills add https://github.com/cloudflare/skills
```

インストールすると、Tendril の計画を実行するコーディングエージェントが、バインディングの作成、ワーカースクリプトのデプロイ、リアルタイムのエッジログの検査を自律的に実行できるようになります。

## Tendril での利用

1. Tendril を開き、**Settings > Coding Agent** に移動します。
2. コーディングエージェントを **OpenCode** に設定します（[OpenCode エージェント](../06_CodingAgents/04_OpenCode.md) を参照）。
3. Tendril は計画タスクを OpenCode にルーティングし、OpenCode が Cloudflare Workers AI を呼び出します。

また、`~/.tendril/config.yaml` 内で [OpenAI](https://openai.com) 互換エンドポイントを介して Cloudflare Workers AI を直接指定することもできます（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-cloudflare-api-token"
      OPENAI_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    profiles:
      - name: deep
        model: "@cf/meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: medium
      - name: quick
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: low
```

> [!NOTE]
> Workers AI モデル推論に加え、Tendril v2 はチームメンバーとの安全な読み取り専用計画共有のために Cloudflare Quick Tunnels（`cloudflared`）をネイティブに統合しています。トンネル共有は **Settings > Security & Tunneling** で個別に設定します。

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [Cloudflare Workers AI ドキュメント](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare + OpenCode ガイド](https://developers.cloudflare.com/agent-setup/opencode/)
