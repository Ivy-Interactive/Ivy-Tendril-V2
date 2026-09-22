---
title: Z.AI
description: Z.AI は専用のコーディングプランオプションを備え、GLM 最先端モデルへの高スループットアクセスを提供します。
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - bigmodel
---

# Z.AI

[Z.AI](https://z.ai)（[Zhipu AI](https://open.bigmodel.cn) により開発）は、自律型プログラミングエージェント、[計画](../02_Concepts/01_Plans.md)、および自動化されたソフトウェア開発ワークフロー向けに最適化された専用コーディングプランを含む、GLM モデルファミリーへのエンタープライズアクセスを提供します。

## セットアップ

1. [Z.AI API コンソール](https://z.ai/manage-apikey/apikey-list) から API キーを取得します。
2. ターミナルまたは Tendril の組み込み PTY を介して [OpenCode](https://opencode.ai) で認証します：
   ```bash
   opencode auth login
   ```
   **Z.AI**（専用コーディングプランを契約している場合は **Z.AI Coding Plan**）を選択し、プロンプトが表示されたら API キーを貼り付けます。
3. OpenCode を起動し、利用可能なモデルを確認します：
   ```bash
   opencode
   ```
   `/models` と入力してアクティブなモデルを切り替えます。

## 推奨モデル

| モデル                | ID                         | プロファイルティア | 最適な用途                                         |
| :-------------------- | :------------------------- | :----------------- | :------------------------------------------------- |
| **GLM 4.7**           | `glm-4.7`                  | Deep               | 複雑なコード生成、アーキテクチャ計画、デバッグ     |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced           | 機能追加、リファクタリング、コードレビュー         |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick              | 高速な lint チェック、単体テスト生成、コミット要約 |

## Tendril での利用

1. Tendril デスクトップアプリケーションを開き、**Settings > Coding Agent** に移動します。
2. アクティブなコーディングエージェントとして **OpenCode** を選択します（[OpenCode エージェント](../06_CodingAgents/04_OpenCode.md) を参照）。
3. Tendril は同梱の [OpenCode](https://opencode.ai) サイドカー（`binaries/opencode`）を呼び出し、エージェントのジョブを Z.AI のバックエンドを通じて直接ルーティングします。

また、`~/.tendril/config.yaml` 内で実行ティアごとに GLM モデルを指定することもできます（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: opencode

codingAgents:
  - name: opencode
    profiles:
      - name: deep
        model: "glm-4.7"
        effort: high
      - name: balanced
        model: "glm-4-plus"
        effort: medium
      - name: quick
        model: "glm-4-air"
        effort: low
```

> [!NOTE]
> Z.AI の Coding Plan は、継続的なエージェント実行や複雑な [計画](../02_Concepts/01_Plans.md) ビルドに合わせて特別に調整された、より高いレート制限と同時リクエスト枠を提供します。

## リンク

- [モデルプロバイダー](_Index.md)
- [コーディングエージェント](../06_CodingAgents/_Index.md)
- [Z.AI プラットフォーム](https://z.ai)
- [Z.AI コンソール](https://z.ai/manage-apikey/apikey-list)
- [Z.AI + OpenCode ドキュメント](https://docs.z.ai/scenario-example/develop-tools/opencode)
