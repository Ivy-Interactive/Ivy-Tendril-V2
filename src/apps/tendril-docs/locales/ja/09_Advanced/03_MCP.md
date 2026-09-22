---
title: MCP サーバー
description: Tendril には、Claude Code などの AI コーディングエージェントに計画管理ツールを公開する Model Context Protocol (MCP) サーバーが含まれています。
icon: Bot
searchHints:
  - mcp
  - model context protocol
  - claude
  - ツール
  - tendril_get_plan
  - tendril_list_plans
  - tendril_start_job
  - tendril_inbox
  - tendril_get_config
---

# MCP サーバー

Tendril には、Claude Code などの AI コーディングエージェントに計画管理、ジョブオーケストレーション、およびプロジェクト検出ツールを公開する Model Context Protocol (MCP) サーバーが含まれています。

## MCP サーバーの起動

```bash
tendril mcp
```

これにより、stdio トランスポート経由で MCP サーバーが起動し、Claude Code の MCP 設定での使用に適した状態になります。標準入力と標準出力は厳密に JSON-RPC メッセージ専用として予約されており、診断ログは stderr に出力されます。

## 認証

MCP セッションでトークン認証を要求するには、`TENDRIL_MCP_TOKEN` 環境変数を設定します。

- **環境変数**: stdio 経由で接続するクライアントは、`TENDRIL_MCP_CLIENT_TOKEN`（または `TENDRIL_MCP_TOKEN`）を介して一致するトークンを提供できます。
- **リクエストメタデータ**: クライアントは、`initialize` パラメータの `_meta["io.tendril/token"]` にリクエストごとにトークンを渡すこともできます。

`TENDRIL_MCP_TOKEN` が未設定または空の場合、認証は無効化され、ローカルリクエストが許可されます。

## 利用可能なツール

すべてのツールにはプレフィックス `tendril_` が付き、デーモンまたはローカルの Tendril ストレージに対して直接動作します。

### 計画の検査とクエリ

| ツール                           | パラメータ                                                               | 説明                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_plan`               | `plan_id` (必須), `field` (オプション)                                   | 計画のメタデータと最新の改訂版を取得します。`field` が指定されている場合、そのフィールドのみを返します（例：`title`、`state`、`project`、`level`、`repos`、`commits`、`prs`、`verifications`、`dependsOn`、`revision`）。 |
| `tendril_list_plans`             | `state` (オプション), `project` (オプション), `search`, `since`, `limit` | フィルタに一致する計画を一覧表示します。`since` は RFC 3339 タイムスタンプを受け入れます。`search` はタイトルまたは ID でフィルタリングします。                                                                           |
| `tendril_get_revision`           | `plan_id` (必須), `number` (オプション)                                  | 計画改訂版の Markdown テキストを取得します（デフォルトは最新版、または指定された改訂番号）。                                                                                                                              |
| `tendril_plan_validate`          | `plan_id` (必須)                                                         | 計画の状態をチェックし、構造やスキーマの問題を報告します。                                                                                                                                                                |
| `tendril_plan_verification_list` | `plan_id` (必須)                                                         | 計画のすべての検証とその現在のステータス（`Pending`、`Pass`、`Fail`、`Skipped`）を一覧表示します。                                                                                                                        |
| `tendril_plan_rec_list`          | `plan_id` (必須), `state` (オプション)                                   | 計画のレコメンデーションを一覧表示します。フィルタ状態：`Pending`、`Accepted`、`AcceptedWithNotes`、`Declined`。                                                                                                          |

### 計画のオーサリングと変更

| ツール                             | パラメータ                                                                                                      | 説明                                                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_plan_create`              | `title` (必須), `project` (必須), `level`, `initial_prompt`, `source_url`, `execution_profile`, `priority`, ... | 新しい計画を作成します。検証ゲートはプロジェクト設定から自動的に初期設定されます。                                                                                                                         |
| `tendril_plan_write_revision`      | `plan_id` (必須), `content` (必須), `reason` (オプション)                                                       | 新しい番号付きの Markdown 改訂版を書き込みます。質問ブロックはスキーマに対して検証されます。                                                                                                               |
| `tendril_plan_set`                 | `plan_id` (必須), `field` (必須), `value` (必須)                                                                | スカラーフィールド（`state`、`title`、`level`、`project`、`executionProfile`、`initialPrompt`、`sourceUrl`、`priority`）を更新します。状態の変更では、`Completed` を許可する前に検証ゲートが適用されます。 |
| `tendril_plan_set_verification`    | `plan_id` (必須), `name` (必須), `status` (必須)                                                                | 検証ゲートのステータス（`Pending`、`Pass`、`Fail`、`Skipped`）を設定します。                                                                                                                               |
| `tendril_plan_verification_remove` | `plan_id` (必須), `name` (必須)                                                                                 | 計画から検証ゲートを削除します。                                                                                                                                                                           |
| `tendril_plan_add_repo`            | `plan_id` (必須), `path` (必須)                                                                                 | リポジトリパスを計画に関連付けます。                                                                                                                                                                       |
| `tendril_plan_remove_repo`         | `plan_id` (必須), `path` (必須)                                                                                 | リポジトリパスの計画との関連付けを解除します。                                                                                                                                                             |
| `tendril_plan_add_pr`              | `plan_id` (必須), `url` (必須)                                                                                  | 計画にプルリクエストの URL を記録します。                                                                                                                                                                  |
| `tendril_plan_add_commit`          | `plan_id` (必須), `sha` (必須)                                                                                  | 計画にコミット SHA を記録します。                                                                                                                                                                          |
| `tendril_plan_add_depends_on`      | `plan_id` (必須), `folder` (必須)                                                                               | ブロッキング計画の依存関係を追加します。依存する計画は、対象が `Completed` に達しその PR がマージされるまで実行されません。                                                                                |
| `tendril_plan_remove_depends_on`   | `plan_id` (必須), `folder` (必須)                                                                               | ブロッキング計画の依存関係を削除します。                                                                                                                                                                   |
| `tendril_plan_add_related_plan`    | `plan_id` (必須), `folder` (必須)                                                                               | コンテキスト参照用に関連計画をリンクします。                                                                                                                                                               |
| `tendril_plan_remove_related_plan` | `plan_id` (必須), `folder` (必須)                                                                               | 関連計画のリンクを削除します。                                                                                                                                                                             |

### レコメンデーション

| ツール                     | パラメータ                                                                    | 説明                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `tendril_plan_rec_add`     | `plan_id` (必須), `title` (必須), `description` (必須), `impact` (オプション) | 影響度レベル（`Small`、`Medium`、`High`）を指定して新しいレコメンデーションを追加します。 |
| `tendril_plan_rec_accept`  | `plan_id` (必須), `title` (必須)                                              | レコメンデーションを承認します。                                                          |
| `tendril_plan_rec_decline` | `plan_id` (必須), `title` (必須), `reason` (オプション)                       | 任意の理由を添えてレコメンデーションを却下します。                                        |
| `tendril_plan_rec_remove`  | `plan_id` (必須), `title` (必須)                                              | 計画からレコメンデーションを削除します。                                                  |

### ジョブと受信トレイ

| ツール                | パラメータ                                                                      | 説明                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_inbox`       | `description` (必須), `project` (オプション), `source_path` (オプション)        | Tendril の受信トレイに新しいタスク説明を送信し、`CreatePlan` ジョブを自動的に起動します。                                                                                                                        |
| `tendril_start_job`   | `job_type` (必須), `plan_id`, `description`, `project`, `note`, `priority`, ... | 実行中のデーモンでバックグラウンドジョブを開始します（`CreatePlan`、`ExecutePlan`、`RetryPlan`、`UpdatePlan`、`ExpandPlan`、`SplitPlan`、`CreatePr`、`CreateIssue`、`SetupProject`、`SyncRepo`、`AddProject`）。 |
| `tendril_list_jobs`   | `status` (オプション), `limit` (オプション)                                     | デーモンから最近のバックグラウンドジョブを一覧表示します。                                                                                                                                                       |
| `tendril_get_job`     | `job_id` (必須)                                                                 | 特定のジョブのステータス、タイミング、トークン数、およびコストの詳細を取得します。                                                                                                                               |
| `tendril_cancel_job`  | `job_id` (必須), `message` (オプション)                                         | 実行中のバックグラウンドジョブをキャンセルします。                                                                                                                                                               |
| `tendril_job_add_log` | `job_id` (必須), `action` (必須), `summary` (オプション)                        | `<TendrilHome>/Jobs/` にナラティブログエントリを追加します。デーモンが停止している場合でもオフラインで機能します。                                                                                               |

### 設定と検出

| ツール                       | パラメータ          | 説明                                                                                                                |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_config`         | `key` (オプション)  | 公開設定値（例：`codingAgent`、`jobTimeout`、`planTemplate`）を読み取ります。機密性の高い認証情報はマスクされます。 |
| `tendril_list_projects`      | —                   | 設定されているすべてのプロジェクトと、そのリポジトリパス、検証、および設定を一覧表示します。                        |
| `tendril_list_verifications` | `name` (オプション) | グローバル検証チェック定義を一覧表示するか、名前で 1 つを検査します。                                               |

> [!NOTE]
> 設定は MCP 経由では読み取り専用です。`planFolder` や `codingAgent` などのマシン全体の設定を変更するには、CLI（`tendril config set`）または Tendril UI を使用する必要があります。

## Claude Code の設定

Tendril の MCP サーバーを Claude Code の設定（`~/.claude/settings.json` またはプロジェクトレベルの `.claude/settings.json`）に追加します。

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"]
    }
  }
}
```

トークン認証を有効にする場合：

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"],
      "env": {
        "TENDRIL_MCP_CLIENT_TOKEN": "your-secret-token"
      }
    }
  }
}
```
