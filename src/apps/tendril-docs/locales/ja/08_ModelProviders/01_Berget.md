---
title: Berget AI
description: 完全な EU データレジデンシーとネイティブの Tendril v2 BYO カードサポートを備え、Kimi および GLM モデルを提供する欧州の AI インフラプロバイダー。
icon: Server
searchHints:
  - berget
  - eu
  - ヨーロッパ
  - kimi
  - glm
  - moonshot
---

# Berget AI

[Berget AI](https://berget.ai) は、スウェーデン国内での EU データレジデンシーを保証し、主権的かつ高性能な LLM 推論を提供する欧州の AI インフラストラクチャプロバイダーです。Berget は、[Moonshot AI](https://moonshot.cn) の Kimi K3 や [Zhipu AI](https://open.bigmodel.cn) の GLM ファミリーなど、最先端のオープンウェイトモデルをホストする [OpenAI](https://openai.com) 互換のエンドポイントを提供しており、[GDPR](https://gdpr.eu) に完全に準拠しています。

Tendril v2 では、Berget AI はデスクトップアプリケーション内のネイティブ **Bring Your Own LLM** カードとして、また同梱の [OpenCode](https://opencode.ai) サイドカー経由の両方でサポートされています。

## Tendril デスクトップ経由でのセットアップ

Berget AI を利用する最も簡単な方法は、デスクトップ設定のネイティブ BYO カードを使用することです：

1. [console.berget.ai](https://console.berget.ai) でアカウントを作成し、API キーを発行します。
2. Tendril を開き、**Settings > Coding Agent** に移動します。
3. **Bring Your Own LLM** の下にある **Berget AI** カードをクリックします。
4. **API Key** フィールドに API キーを貼り付け、**Save** をクリックします。

> [!NOTE]
> UI 上に Berget 用のベース URL を設定する項目はありません。Tendril v2 は自動的にエンドポイントを `https://api.berget.ai/v1` に固定し、同梱の [OpenCode](../06_CodingAgents/04_OpenCode.md) サイドカー経由でリクエストをルーティングします。

## `config.yaml` での手動設定

Berget AI は `~/.tendril/config.yaml` で直接設定することも可能です（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-berget-..."
      OPENAI_BASE_URL: "https://api.berget.ai/v1"
      ANTHROPIC_API_KEY: "sk-berget-..."
      ANTHROPIC_BASE_URL: "https://api.berget.ai"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: max
      - name: balanced
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: quick
        model: "moonshotai/Kimi-K3"
        effort: low
```

## 推奨モデル

Tendril v2 のプロファイルリゾルバーは、すべてのティアで Berget AI を Kimi K3 に直接マッピングします：

| ティア       | モデル ID            | デフォルトエフォート | 用途                                                     |
| :----------- | :------------------- | :------------------- | :------------------------------------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`                | アーキテクチャ計画、複雑な推論、大規模なリファクタリング |
| **Balanced** | `moonshotai/Kimi-K3` | `high`               | 標準的な計画実行およびコード生成                         |
| **Quick**    | `moonshotai/Kimi-K3` | `low`                | 迅速な検証、コミット要約、ステータスレポート             |

Berget は GLM ファミリーのモデル（`GLM-4.7` など）も提供しています。プロファイル設定に利用可能な任意の Berget モデル ID を指定するか、[OpenCode](../06_CodingAgents/04_OpenCode.md) 内で `/models` を使用して選択できます。

## OpenCode CLI 経由でのセットアップ

または、OpenCode 経由で Berget を設定することもできます：

1. Berget セットアップユーティリティを実行します：
   ```bash
   npx berget code init
   ```
2. OpenCode を起動します：
   ```bash
   opencode
   ```
3. Tendril の **Settings > Coding Agent** で、アクティブなエージェントを OpenCode に設定します（`codingAgent: opencode`）。

> [!TIP]
> Tendril v2 には [OpenCode](https://opencode.ai) バイナリが同梱されています（`binaries/opencode`）。Tendril で Berget を使用するために、システムに Node.js や OpenCode をグローバルインストールする必要はありません。詳細は [OpenCode エージェントガイド](../06_CodingAgents/04_OpenCode.md) を参照してください。

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [Berget AI ホームページ](https://berget.ai)
- [Berget コンソール](https://console.berget.ai)
- [Berget + OpenCode ドキュメント](https://docs.berget.ai/integrations/opencode)
