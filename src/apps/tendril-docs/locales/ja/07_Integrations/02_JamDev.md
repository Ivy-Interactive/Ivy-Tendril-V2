---
title: Jam.dev
description: jam.dev を Tendril と連携し、受信トレイ API Webhook を介してバグレポートから自動的に計画を作成します。
icon: Bug
searchHints:
  - jam
  - jam.dev
  - webhook
  - inbox api
  - バグレポート
---

# Jam.dev

## 概要

[Jam.dev](https://jam.dev) は Tendril の受信トレイ API エンドポイントにバグレポートを送信でき、Tendril は `CreatePlan` [プロンプトウェア](../02_Concepts/02_Promptwares.md) を介して自動的に[計画](../02_Concepts/01_Plans.md)を作成します。基盤となる HTTP エンドポイントの詳細については、[REST API](../09_Advanced/02_REST.md) を参照してください。

## Webhook URL

[Jam.dev](https://jam.dev) から以下の URL に POST するように設定します:

```
http://localhost:5010/api/inbox
```

Tendril のホストとポートが異なる設定になっている場合は、`localhost:5010` を置き換えてください。サーバー設定の詳細については、[セットアップと設定](../03_Configuration/01_Setup.md) を参照してください。

## リクエスト形式

JSON ボディを含む POST リクエストを送信します:

```json
{
  "description": "jam.dev からのバグの説明",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| フィールド    | 必須   | 説明                                                                               |
| ------------- | ------ | ---------------------------------------------------------------------------------- |
| `description` | はい   | バグレポートまたは Issue の説明                                                    |
| `project`     | いいえ | 対象プロジェクト名（デフォルトは `Auto`）                                          |
| `sourcePath`  | いいえ | 関連するソースコードのパスのヒント                                                 |
| `force`       | いいえ | 同一のジョブが既に実行中であっても強制的に作成するかどうか（デフォルトは `false`） |

## 認証

`config.yaml` で `api.apiKey` を設定している場合は、リクエストヘッダーに `X-Api-Key` として含めます:

```http
X-Api-Key: your-api-key
```

デーモンシークレットを使用して認証することもできます:

```http
Authorization: Bearer <secret>
```

> [!TIP]
> `api.apiKey` が設定されていない場合は、デーモンシークレットまたはローカルループバック接続が使用されます。チームまたはリモート環境では、`config.yaml` で API キーを設定してください。

## レスポンス

リクエストが成功すると、HTTP 200 が返されます:

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

`CreatePlan` ジョブが既に実行中であるにもかかわらず同一の説明が送信され、`force` が `true` でない場合、Tendril は HTTP 409 Conflict を返します:

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## jam.dev でのセットアップ

1. jam.dev ワークスペースの設定を開きます
2. インテグレーションまたは Webhook に移動します
3. Tendril 受信トレイ URL（`http://localhost:5010/api/inbox`）を指す新しい Webhook を追加します
4. 認証が有効な場合はヘッダー（`X-Api-Key` など）を設定します
5. 上記のリクエスト形式に一致するようにペイロードを設定します
