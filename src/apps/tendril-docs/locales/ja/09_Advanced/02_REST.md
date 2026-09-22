---
title: REST API
description: Tendril は、Tendril サーバー URL（デフォルトポート 5010）でプログラムによる計画とジョブの管理を行うための HTTP および WebSocket API を公開しています。
icon: Server
searchHints:
  - api
  - rest
  - http
  - エンドポイント
  - 計画
  - ジョブ
  - 受信トレイ
  - 認証
  - bearer
  - X-Api-Key
  - websocket
  - イベント
---

# REST API

Tendril は、プログラムによる計画とジョブの管理のために、HTTP REST API および WebSocket インターフェースを公開しています。デフォルトでは、API サーバーは `http://127.0.0.1:5010`（または `http://localhost:5010`）でリッスンします。`tendril serve` を `--tls-cert` および `--tls-key` を指定して起動すると、HTTPS での配信が有効になります。

## 認証

Tendril は、Bearer 認証情報、オプションの API キー、または基本パスワード認証を使用して API エンドポイントを保護します。

### デーモンの Bearer シークレット

デーモンが起動すると、暗号学的に安全な 32 バイトの Bearer シークレットを生成し、`<home>/.master` に書き込みます。保護された API ルートでは、`Authorization` または `X-Api-Key` ヘッダーにこのシークレットを含める必要があります。

```bash
# Authorization ヘッダーを使用する場合
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# X-Api-Key ヘッダーを使用する場合
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

`/api/ws` での WebSocket 接続の場合は、クエリ文字列でシークレットを渡します。

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### 設定された API キー

`config.yaml` で `api.apiKey` が設定されている場合、リクエストは `X-Api-Key: <configured-key>` を送信して API キー要件も満たす必要があります。

```yaml
# config.yaml
api:
  apiKey: "your-secret-key"
```

```bash
curl -H "Authorization: Bearer <daemon-secret>" \
     -H "X-Api-Key: your-secret-key" \
     http://127.0.0.1:5010/api/plans
```

### パスワード認証

`config.yaml` で `auth:` が設定されている場合、呼び出し元は `Authorization: Basic <base64(user:password)>` を使用するか、`POST /api/auth/login` から署名付き JWT セッショントークンを取得して認証できます。セッショントークンは 15 分間有効で、`Authorization: Bearer <session-token>` 経由で受け入れられます。

### 認証不要のエンドポイント

以下のプローブエンドポイントは認証を必要としません。

- `GET /api/health` — PID、バージョン、API バージョン、および機能リストを返すプライマリヘルスチェック
- `GET /api/jobs/health` — ヘルスチェックのエイリアス
- `GET /api/ping` — `{"ping": "pong"}` を返す ping/pong レディネスチェック
- `POST /api/auth/login` — パスワード認証エンドポイント

## 計画 (Plans)

### 計画の一覧取得

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| パラメータ | 型     | 説明                                                                                                                                      |
| ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `status`   | string | 計画の状態によるフィルタ（`Draft`、`Creating`、`Updating`、`Executing`、`Completed`、`Failed`、`Review`、`Skipped`、`Icebox`、`Blocked`） |
| `state`    | string | `status` のエイリアス                                                                                                                     |
| `project`  | string | プロジェクト名によるフィルタ                                                                                                              |
| `level`    | string | レベルによるフィルタ（例：`Feature`、`Bug`）                                                                                              |
| `q`        | string | 計画のタイトルとコンテンツを対象としたテキスト検索フィルタ                                                                                |
| `limit`    | int    | 最大取得件数（デフォルトは無制限）                                                                                                        |

### 計画の作成

```http
POST /api/plans
Content-Type: application/json

{
  "title": "Fix login validation bug",
  "project": "MyProject",
  "level": "Bug",
  "initialPrompt": "Fix the issue where empty passwords crash the auth handler",
  "priority": 10
}
```

### 計画の取得

```http
GET /api/plans/{planId}
GET /api/plans/{planId}?field=state
```

計画レコード全体を返します。`?field=` が指定されている場合は単一フィールドの文字列を返します。サポートされているフィールド：`id`、`title`、`state`、`project`、`level`、`created`、`updated`、`executionProfile`、`initialPrompt`、`sourceUrl`、`priority`、`partialDelivery`、`repos`、`prs`、`commits`、`verifications`、`dependsOn`、`relatedPlans`、`recommendations`。

### フィールドの更新

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

サポートされているフィールド：`state`、`title`、`level`、`project`、`executionProfile`、`initialPrompt`、`sourceUrl`、`priority`。

計画のいずれかの検証が `Fail` 状態にある間に `state` を `Completed` に設定すると、`400` が返されます。`"allowFailedVerifications": true` を追加すると強制的に記録され、計画には `partialDelivery: true` のフラグが付けられます。

### 計画の削除

```http
DELETE /api/plans/{planId}
```

### リポジトリ

```http
POST /api/plans/{planId}/repos
DELETE /api/plans/{planId}/repos
Content-Type: application/json

{
  "repoPath": "/path/to/repo"
}
```

### プルリクエストとコミット

```http
POST /api/plans/{planId}/prs
Content-Type: application/json

{
  "prUrl": "https://github.com/org/repo/pull/42"
}
```

```http
POST /api/plans/{planId}/commits
Content-Type: application/json

{
  "sha": "abc1234def5678"
}
```

### 依存関係と関連計画

```http
POST /api/plans/{planId}/depends-on
DELETE /api/plans/{planId}/depends-on
Content-Type: application/json

{
  "dependsOn": "00041-setup-database"
}
```

```http
POST /api/plans/{planId}/related-plans
DELETE /api/plans/{planId}/related-plans
Content-Type: application/json

{
  "relatedPlan": "00039-refactor-auth"
}
```

### 計画の検証

```http
GET /api/plans/{planId}/verifications
POST /api/plans/{planId}/verifications
Content-Type: application/json

{
  "name": "CargoTest",
  "status": "Pending"
}
```

```http
PUT /api/plans/{planId}/verifications/{name}
Content-Type: application/json

{
  "status": "Pass"
}
```

```http
DELETE /api/plans/{planId}/verifications/{name}
```

有効な検証ステータス：`Pending`、`Pass`、`Fail`、`Skipped`。

### 改訂版とバリデーション

```http
GET /api/plans/{planId}/revisions
POST /api/plans/{planId}/revisions
PUT /api/plans/{planId}/revisions/latest
POST /api/plans/{planId}/validate
```

## レコメンデーション (Recommendations)

### レコメンデーションの一覧取得

```http
GET /api/plans/{planId}/recommendations
GET /api/plans/{planId}/recommendations?state=Pending
GET /api/recommendations
```

フィルタ状態：`Pending`、`Accepted`、`AcceptedWithNotes`、`Declined`。`GET /api/recommendations` はすべての計画を横断してクエリします。

### レコメンデーションの追加

```http
POST /api/plans/{planId}/recommendations
Content-Type: application/json

{
  "title": "Add integration test",
  "description": "Coverage is missing for the password reset route",
  "impact": "Medium"
}
```

影響度レベル：`Small`、`Medium`、`High`。

### レコメンデーションの承認 / 却下

```http
PUT /api/plans/{planId}/recommendations/{title}/accept
Content-Type: application/json

{
  "notes": "Covered via end-to-end suite"
}
```

```http
PUT /api/plans/{planId}/recommendations/{title}/decline
Content-Type: application/json

{
  "reason": "Scope intentionally deferred to next milestone"
}
```

### レコメンデーションの削除

```http
DELETE /api/plans/{planId}/recommendations/{title}
```

## 受信トレイ (Inbox)

### 計画タスクの送信

```http
POST /api/inbox
Content-Type: application/json

{
  "description": "Fix login validation bug",
  "project": "MyProject",
  "sourcePath": "/path/to/source",
  "force": false
}
```

`CreatePlan` バックグラウンドジョブを開始し、以下を返します。

```json
{
  "jobId": "00143",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

### 提案とスイープ

```http
POST /api/inbox/check
GET /api/inbox/proposals
POST /api/inbox/proposals/{id}/accept
POST /api/inbox/proposals/{id}/dismiss
```

## ジョブ (Jobs)

### ジョブの開始

```http
POST /api/jobs
Content-Type: application/json

{
  "type": "ExecutePlan",
  "folderPath": "Plans/00042-fix-login",
  "priority": 10,
  "waitForJobs": ["00140"]
}
```

リクエストボディは多態的な `"type"` 識別子を使用します。利用可能なジョブタイプ：`CreatePlan`、`ExecutePlan`、`RetryPlan`、`ExpandPlan`、`UpdatePlan`、`SplitPlan`、`CreatePr`、`CreateIssue`、`SetupProject`、`SyncRepo`、`AddProject`。

### ジョブの一覧取得

```http
GET /api/jobs?status=Running&limit=20
```

### ジョブのクエリ（サーバーページングおよびフィルタリング）

```http
POST /api/jobs/query
Content-Type: application/json

{
  "offset": 0,
  "limit": 25,
  "sort": [{ "column": "StartedAt", "descending": true }]
}
```

### ジョブキュー

```http
GET /api/jobs/queue
```

現在キューに入っているジョブのリストをディスパッチ順で返します。

### ジョブ詳細の取得

```http
GET /api/jobs/{jobId}
```

### ジョブのキャンセルまたは削除

```http
POST /api/jobs/{jobId}/cancel
DELETE /api/jobs/{jobId}
```

### 進捗および障害の報告

```http
PUT /api/jobs/{jobId}/status
Content-Type: application/json

{
  "message": "Running unit tests...",
  "planId": "00042",
  "planTitle": "Fix login validation bug"
}
```

```http
PUT /api/jobs/{jobId}/fail
Content-Type: application/json

{
  "message": "Test execution failed with exit code 1"
}
```

### ジョブログとストリーム

```http
# エージェントのナラティブログエントリを追加
POST /api/jobs/{jobId}/logs
Content-Type: application/json

{
  "action": "ExecutePlan",
  "summary": "Completed successfully"
}

# ログの取得
GET /api/jobs/{jobId}/logs

# ログの SSE リアルタイムストリーム
GET /api/jobs/{jobId}/logs/stream

# ジョブライフサイクルイベントの SSE リアルタイムストリーム
GET /api/jobs/{jobId}/events
```

## WebSocket とイベント

### ライブ WebSocket ストリーム

WebSocket エンドポイントに接続して、計画、ジョブ、チャットセッション、およびステータス遷移のリアルタイムブロードキャストイベントを受信します。

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

`?since=<seq>` を渡すと、リアルタイム更新のストリーミングを開始する前に、そのシーケンス番号以降のすべてのバッファされたイベントが再生されます。

### REST バックフィル

WebSocket 接続を開いたまま維持することが実用的でない場合は、HTTP 経由でイベントリングバッファをポーリングします。

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## ヘルスチェック

```http
GET /api/health
```

レスポンス：

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
