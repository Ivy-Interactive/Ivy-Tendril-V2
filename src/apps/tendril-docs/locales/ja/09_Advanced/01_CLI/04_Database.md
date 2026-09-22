---
title: データベース
description: 計画同期データ、レコメンデーション、ジョブ履歴、およびコスト追跡を保存するローカル SQLite データベースを管理します。
icon: Database
searchHints:
  - データベース
  - db
  - マイグレーション
  - migration
  - スキーマ
  - バージョン
  - reset
  - sqlite
  - 整合性
  - vacuum
---

# データベース

[計画同期データ](../../02_Concepts/01_Plans.md)、[ジョブ履歴](../../04_Apps/04_Jobs.md)、レコメンデーション、およびコスト追跡を保存するローカル [SQLite](https://www.sqlite.org) データベース（`<TendrilHome>/tendril.db`）を管理します。Tendril v2 では、すべてのデータベース管理は `tendril db` サブコマンドツリーを介してアクセスされます。

## Commands

#### db version

```terminal
>tendril db version
```

マイグレーションを適用せずにデータベーススキーマを検査します。現在のデータベースバージョン、インストールされているバイナリが期待する最新バージョン、およびマイグレーションステータス（`Up to date`、`Needs migration`、または `Newer than application`）を出力します。

```terminal
Database version: 12
Latest version:   12
Status:           Up to date
```

#### db migrate

```terminal
>tendril db migrate
```

保留中のすべてのマイグレーションを適用して、データベーススキーマを最新の状態にします。繰り返し実行しても安全です（適用済みのマイグレーションは冪等にスキップされます）。

> [!NOTE]
> `tendril run` はデーモンサーバーを起動する前に保留中のマイグレーションを自動的に適用するため、手動でマイグレーションを行う必要はほとんどありません。

#### db reset

```terminal
>tendril db reset
>tendril db reset --force
```

`tendril.db` 内のすべてのテーブルを削除し、スキーマを一から再作成します。`--force` が指定されていない限り、確認プロンプトが表示されます。デーモンが現在アクティブな場合、`--force` が指定されない限り実行を拒否します。

> [!WARNING]
> リセットすると、すべてのデータベースレコード（キャッシュされたジョブ履歴、テレメトリ、レコメンデーション）が削除されます。ディスク上の作成済み [計画 YAML ファイル](01_Plan.md) およびリビジョンマークダウンファイルには一切影響しません。

#### db integrity

```terminal
>tendril db integrity
```

すべてのテーブル、インデックス、ページにわたって SQLite の [PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check) を実行します。各検証結果を出力し、破損や構造的な異常が見つかった場合は終了コード 1 で終了します。

#### db vacuum

```terminal
>tendril db vacuum
>tendril db vacuum --force
```

SQLite の [VACUUM](https://www.sqlite.org/lang_vacuum.html) を実行してデータベースをデフラグし、インデックスを再構築して未使用のディスク領域を回収します。実行前後のデータベースサイズと回収された合計バイト数をレポートします。

## Related

- [CLI の概要](00_Overview.md) — グローバルオプション、データディレクトリパス、およびインストールヘルスチェック
- [Plan コマンド](01_Plan.md) — ディスクに保存されている計画の作成、一覧表示、および検証
