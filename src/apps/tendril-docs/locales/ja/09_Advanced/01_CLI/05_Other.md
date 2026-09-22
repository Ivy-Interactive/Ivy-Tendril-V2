---
title: その他のコマンド
description: プロンプトウェアの実行、バックグラウンドジョブのオーケストレーション、チャットセッション、バックグラウンドサービスの登録、およびユーティリティ。
icon: Wrench
searchHints:
  - promptware
  - memory
  - tool
  - job
  - chat
  - service
  - autostart
  - launchd
  - systemd
  - status
  - models
  - hash-password
  - generate-certs
  - agent-instructions
---

# その他のコマンド

プロンプトウェアの実行、バックグラウンドジョブの追跡、対話型チャットセッション、OS バックグラウンドサービスの管理、および Tendril CLI ユーティリティコマンドのリファレンスです。

## promptware

Tendril はエージェントの実行ワークフローを構造化するために [プロンプトウェア](../../02_Concepts/02_Promptwares.md) を使用します。背景の詳細については、[プロンプトウェアの概念](../../02_Concepts/02_Promptwares.md) を参照してください。

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

サーバーのジョブキューをバイパスして、ホストマシン上でプロンプトウェアを直接実行します。

| オプション             | 効果                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `--profile <profile>`  | エージェントの推論プロファイルを上書き（`deep`、`balanced`、`quick`）                       |
| `--working-dir <path>` | エージェント実行プロセスの作業ディレクトリ                                                  |
| `--value <key=value>`  | 追加のファームウェアヘッダー値（複数指定可）                                                |
| `--plan <id>`          | 対象の計画 ID またはフォルダーパス                                                          |
| `--agent <provider>`   | エージェントプロバイダーを上書き（`claude`、`antigravity`、`codex`、`copilot`、`opencode`） |
| `--dry-run`            | コンパイルされたファームウェアを stdout に出力し、エージェントを起動せずに終了              |

#### Memory と Tools

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

エージェントはこれらのコマンドを使用して、学習したパターンをプロンプトウェアの `Memory/` ディレクトリに永続化し、`Tools/` 内にカスタムツールを作成します。

#### Deployment & Layers

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — 標準プロンプトウェアをコンパイルし、`<TendrilHome>/Promptwares/` にインストールします。
- **layers** — 各プロンプトウェアファイルを提供したレイヤー（出荷時デフォルトまたはチームオーバーレイ）を検査します。

## job

非同期バックグラウンドエージェントジョブを管理します。ジョブはデーモンキューを介して実行され、リアルタイムのステータスを報告します。UI での確認については、[Jobs アプリ](../../04_Apps/04_Jobs.md) を参照してください。

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

Tendril デーモンサーバーからの最近のバックグラウンドジョブを一覧表示します。

| オプション          | 効果                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--status <status>` | ステータスでフィルター（`Pending`、`Queued`、`Running`、`Completed`、`Failed`、`Timeout`、`Stopped`、`Blocked`） |
| `--limit <n>`       | 最大結果件数（デフォルト: 20）                                                                                   |
| `--json`            | ジョブを構造化 JSON として出力                                                                                   |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

実行中の Tendril デーモン上で非同期バックグラウンドジョブを開始します。サポートされているジョブタイプ: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`。

| オプション                | 効果                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `--priority <number>`     | キューディスパッチの優先順位（高い数値が優先的に実行）                         |
| `--chat-session <id>`     | ジョブをチャットセッションに関連付け（デフォルト: `$TENDRIL_CHAT_SESSION_ID`） |
| `--wait-for <job-id>`     | このジョブがキューに入る前に完了している必要があるジョブ ID（複数指定可）      |
| `--idempotency-key <key>` | 冪等性トークン: 再送信時に別のジョブを作成する代わりに既存のジョブを返却       |
| `--force`                 | 同一の処理が既に実行中であっても強制的に再送信                                 |
| `--description <text>`    | タスクの説明（`CreatePlan` で使用）                                            |
| `--project <name>`        | 対象プロジェクト（`CreatePlan` で使用）                                        |
| `--note <text>`           | 実行ノート（`ExecutePlan` で使用）                                             |
| `--instructions <text>`   | 調整プロンプト（`UpdatePlan` で使用）                                          |
| `--change-request <text>` | レビュアーからのフィードバック（`RetryPlan` で使用）                           |
| `--repo <name>`           | リポジトリ（`CreateIssue` で使用）                                             |
| `--assignee <user>`       | GitHub 上のアサイニーユーザー名（`CreateIssue` / `CreatePr` で使用）           |
| `--reviewer <user>`       | GitHub 上のレビュアーユーザー名（`CreatePr` で使用、複数指定可）               |
| `--draft`                 | ドラフト PR として作成（`CreatePr` で使用）                                    |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status と fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

進捗テレメトリまたはジョブの失敗をデーモンに直接報告します。実行中にプロンプトウェアスクリプトによって内部的に使用されます。

#### job cancel と delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — 実行中のジョブに中止シグナルを送ります。
- **delete** — データベースからジョブレコードを削除します（ディスク上のログファイルは保持されます）。

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

`<TendrilHome>/Jobs/` にあるジョブのログファイルに直接 `## Agent Log` 説明エントリを追加します。ファイルシステム上で直接動作し、サーバーデーモンへの接続は不要です。

#### Queue と Maintenance

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — ディスパッチ順に保留中ジョブを表示
- **force-start** — 同時実行制限や依存ゲートをバイパスして、ジョブを即座にディスパッチ
- **stop-all** — すべてのアクティブおよびキューに入っているジョブをキャンセル
- **clear** — 完了または失敗したジョブを一括削除
- **maintenance** — ジョブのクリーンアップと調整処理を即座に実行

## chat

ターミナルからインタラクティブなエージェントコーディングセッションを実行します：

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

`tendril chat send` はデーモンに接続し、プロンプトターンをディスパッチして、リアルタイムのトークン応答とツール呼び出しイベントを stdout に直接ストリーミングします。

## service

プラットフォーム間で Tendril バックグラウンドデーモンの自動起動サービスを管理します：

- **macOS** — `~/Library/LaunchAgents/io.tendril.daemon.plist` に [launchd](https://en.wikipedia.org/wiki/Launchd) エージェントを登録
- **Linux** — [systemd](https://systemd.io) ユーザーサービスユニットを登録
- **Windows** — [タスクスケジューラ](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page) にスケジュールされたタスクを登録

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — 実行中の実行可能ファイルをバックグラウンドサービスとして登録します。すぐに起動せずに次のログイン時に登録する場合は `--no-start` を使用します。
- **status** — サービスが登録され、ロードされ、配信中であるかどうかをレポートします（URL と PID を含む）。
- **uninstall** — 自動起動設定の登録を解除します。`<home>/bin` にインストールされたサイドカーを削除するには `--purge-binaries` を使用します。

## Utilities

#### models

```terminal
>tendril models
>tendril models --refresh
```

サポートされている LLM モデル、プロバイダー、コンテキストウィンドウ制限、およびリアルタイム価格を一覧表示します。モデルレジストリから更新されたレートを取得するには `--refresh` を使用します。

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

`tendril serve --tls-cert <path> --tls-key <path>` で HTTPS 配信を行うための自己署名 `localhost.crt` と `localhost.key` の PEM ペアを生成します。

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

`config.yaml` の `auth:` セクションで使用するためのパスワードを [Argon2](https://en.wikipedia.org/wiki/Argon2) でハッシュ化します。エンコードされたハッシュ文字列とペッパーシークレットを出力します。

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

ディレクトリを検査し、言語ランタイム、パッケージマネージャー、テストフレームワークを識別するトリミングされた YAML スタック分析を出力します。

#### agent-instructions

```terminal
>tendril agent-instructions
```

インストールパスが置換された完全なエージェントシステムプロンプトテンプレートをコンパイルして出力し、自律エージェントプロンプトにパイプできるようにフォーマットします。

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

計画作成時に設計された React ワイヤーフレームのスキャフォールド、提供、ホットリロードによるプレビュー、およびスクリーンショット取得を行います。
