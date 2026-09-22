---
title: CLI の概要
description: ターミナルから直接、計画、プロジェクト、データベース、およびエージェントを管理します。tendril バイナリは、サーバーデーモンとフル機能の CLI ツールの両方として機能します。
icon: Terminal
searchHints:
  - cli
  - コマンド
  - ターミナル
  - tendril
  - シェル
  - reset
  - report-bug
  - run
  - serve
  - doctor
  - version
  - config
---

# CLI の概要

ターミナルから直接、計画、プロジェクト、データベース、およびエージェントを管理します。`tendril` バイナリは、サーバーデーモンとフル機能の CLI ツールの両方として機能します。

Tendril CLI を使用すると、UI を操作することなくワークフローを完全に制御できます：

- **計画 (Plans)** — 計画の作成、一覧表示、更新、詳細確認。リポジトリ、ワークツリー、検証、レコメンデーションの管理。
- **プロジェクト (Projects)** — プロジェクト、リポジトリ、ビルド依存関係、レビューアクション、MCP サーバー、カスタムスキルの設定。
- **検証 (Verifications)** — 再利用可能な検証チェックの定義と管理。
- **設定 (Config)** — `config.yaml` に保存されているトップレベル設定の読み取りと更新。
- **ボルト (Vault)** — チームボルトの接続、リモートリポジトリの検出、アセットの同期、プロジェクトのインポートやプッシュ。
- **データベース (Database)** — マイグレーションの実行、スキーマバージョンの確認、テーブルのリセット、整合性チェック、バキューム。
- **エージェントとジョブ (Agents & Jobs)** — プロンプトウェアの実行、バックグラウンドジョブの管理、インタラクティブなチャットセッションの操作。

## クイックスタート

**1. インストールの確認**

```terminal
>tendril doctor
```

**2. デーモンサーバーの起動**

```terminal
>tendril run
```

**3. 新しい計画の作成**

```terminal
>tendril plan create "Fix login bug" MyProject
```

**4. アクティブな計画の一覧表示**

```terminal
>tendril plan list --state Executing
```

**5. すべてをリセットして最初からやり直す**

```terminal
>tendril reset
```

> [!TIP]
> すべてのコマンドは `--help` による詳細な使用方法の表示に対応しています。例: `tendril plan create --help`。

## グローバルオプション

| フラグ          | 効果                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `--home <path>` | Tendril ホームディレクトリのパス（`TENDRIL_HOME` 環境変数でも設定可能） |

## 環境変数

| 変数            | 用途                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME`  | 設定、データベース、受信トレイ、計画のルートディレクトリ（デフォルト: `~/.tendril` または `D:\.tendril`）                                                             |
| `TENDRIL_PLANS` | 計画ディレクトリの上書き（デフォルト: `TENDRIL_HOME/Plans`）                                                                                                          |
| `RUST_LOG`      | stderr へのプロセスログ出力のフィルタディレクティブ（デフォルト: `warn,tendril_cli=info,tendril_core=info,tendril_server=info`）。詳細な診断ログには `debug` を指定。 |

## 一般的なコマンド

#### doctor

```terminal
>tendril doctor
>tendril doctor --rebuild-search-index
```

Tendril のインストール状況を検証します — `TENDRIL_HOME`、`config.yaml`、必要なツール（`git`、`gh`）、データベース接続、エージェントモデルの利用可否をチェックします。`--rebuild-search-index` を使用すると、データベースから全文検索インデックスを再生成します。

#### plan doctor

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

すべての計画フォルダーをスキャンして健全性をレポートします：欠落または破損した `plan.yaml`、古いワークツリー、失敗した検証があるまま `Completed` になっている計画を検出します。オプションとヘルスコードの完全なリファレンスについては、[Plan](01_Plan.md#doctor) を参照してください。

#### serve と run

```terminal
>tendril serve --port 5010 --host 127.0.0.1
>tendril serve --tls-cert /path/localhost.crt --tls-key /path/localhost.key
>tendril run
```

`tendril serve` は HTTP および WebSocket API サーバーを起動します（デフォルトポート `5010`、ホスト `127.0.0.1`）。オプションの `--tls-cert` および `--tls-key` フラグで HTTPS 配信を行います。

`tendril run` は、対象ポートが利用可能であることを確認し、保留中のデータベースマイグレーションを自動的に適用してからデーモンを起動します。

#### reset

```terminal
>tendril reset
>tendril reset --force
```

マシンからすべての Tendril データを削除します — `TENDRIL_HOME` および `TENDRIL_PLANS` を削除します。`--force` が指定されていない限り、確認プロンプトが表示されます。

> [!WARNING]
> これにより、対象ディレクトリ内のすべての計画、ジョブ、および設定データが完全に削除されます。

#### report-bug

```terminal
>tendril report-bug --plan 00042
>tendril report-bug --job 00150 -d "Agent failed to create worktree"
>tendril report-bug --plan 00042 --out ~/Desktop/diagnostics.zip
>tendril report-bug --plan 00042 --submit --yes
```

計画ファイルとすべてのジョブアーティファクト — `<TendrilHome>/Jobs/` の Job Log、Job Prompt、Job Raw Log、Job Eventwire Log — を、サニタイズされた設定およびヘルス診断情報とともに zip アーカイブに収集します。`--submit` と `--yes` が指定されている場合、アーカイブをアップロードして GitHub issue を作成します。

| オプション              | 効果                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `--plan <id>`           | この計画フォルダーとそれに対して実行されたすべてのジョブを含める |
| `--job <id>`            | このジョブの 4 つのアーティファクトと計画のコンテキストを含める  |
| `-d, --description <t>` | バグの説明（省略時は対話形式でプロンプト表示）                   |
| `--out <path>`          | zip アーカイブの出力先パス                                       |
| `--github-user <name>`  | issue フォローアップ用の GitHub ユーザー名                       |
| `--submit`              | レポートを GitHub にアップロード（`--yes` が必要）               |
| `-y, --yes`             | 確認プロンプトをスキップ                                         |

> [!WARNING]
> レポートを送信すると、zip バンドルが**公開** GitHub issue に添付されます。シークレットは設定やジョブログから除去されますが、送信前に計画内容を確認してください。

#### version

```terminal
>tendril version
```

インストールされている Tendril のバージョンを表示します（例: `tendril v2.0.0`）。

#### update-promptwares

```terminal
>tendril update-promptwares
>tendril update-promptwares --dry-run
>tendril update-promptwares --source /path/to/promptwares
```

`<TendrilHome>/Promptwares/` にデプロイされたプロンプトウェアを更新し、その `Memory/` および `Tools/` ディレクトリを保持します。

## 次のステップ

- [Plan コマンド](01_Plan.md) — 計画の作成と管理に関する完全なリファレンス
- [Project コマンド](02_Project.md) — プロジェクト、リポジトリ、レビューアクション、MCP サーバー、スキルの設定
- [Verification コマンド](03_Verification.md) — グローバル検証定義の管理
- [Database コマンド](04_Database.md) — マイグレーション、スキーマバージョン、整合性、バキューム
- [Other コマンド](05_Other.md) — プロンプトウェア、ジョブ、チャット、サービス、ユーティリティ
- [Config コマンド](06_Config.md) — トップレベルの `config.yaml` 設定の読み取りと更新
- [Vault コマンド](07_Vault.md) — チームボルトの接続、アセットの同期、プロジェクトのインポートまたは公開
