---
title: ヘルプとサポート
description: お困りですか？サポートを受ける方法と Tendril コミュニティへの参加方法について説明します。
icon: LifeBuoy
searchHints:
  - ヘルプ
  - サポート
  - discord
  - github issues
  - コミュニティ
  - バグ報告
  - report-bug
  - doctor
---

# ヘルプとサポート

問題が発生した場合や、Tendril の設定に関して疑問がある場合は、複数のサポートリソースと診断ツールを利用できます。

## 最初に診断を実行する

issue を送信したりヘルプを求めたりする前に、Tendril に組み込まれている環境診断ツールを実行してください：

```bash
tendril doctor
```

`tendril doctor` は、`$TENDRIL_HOME` ディレクトリ、`config.yaml` の構文、[SQLite](https://www.sqlite.org) データベースへのアクセス、[計画](../02_Concepts/01_Plans.md) ディレクトリ、[Git](https://git-scm.com/)、および [GitHub CLI](https://cli.github.com/) の認証を検証します。

特定の計画やジョブが失敗した場合は、`tendril report-bug` を使用して診断情報をパッケージ化できます：

```bash
# 計画の状態、検証レポート、ジョブログを ZIP にパッケージ化
tendril report-bug <plan-id>
```

これにより、機密性の高い認証情報を公開することなく、計画の YAML、改訂履歴、検証出力、および生の文字起こし記録をまとめた診断アーカイブが生成されます。

## トラブルシューティング

一般的なエラーメッセージ、データベースマイグレーション、およびワークツリーの復旧手順については、[トラブルシューティング](06_Troubleshooting.md) を参照してください。

## Discord コミュニティ

開発チームや他の開発者に連絡を取る最も早い方法は、公式 [Discord サーバー](https://discord.gg/FHgxkDga3y) です。質問をしたり、フィードバックを共有したり、カスタムプロンプトウェアワークフローについて議論したりできます。

## GitHub issues

バグを発見した場合や新機能を提案したい場合は、[GitHub リポジトリ](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues) で issue を作成してください。

> [!TIP]
> issue の説明には、必ず `tendril doctor` と `tendril version` の出力を記載してください。計画の実行失敗を報告する場合は、`tendril report-bug <plan-id>` で生成された診断用 ZIP または `$TENDRIL_HOME/Jobs/` のジョブログを添付してください。

## 次のステップ

- [トラブルシューティング](06_Troubleshooting.md) — 一般的なエラーの兆候と修正方法。
- [ライフサイクルとジョブ](../02_Concepts/03_Lifecycle.md) — ジョブのステータスとエラー処理の理解。
