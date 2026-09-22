---
title: セットアップと設定
description: アプリ内の設定 UI または TENDRIL_HOME/config.yaml の編集により Tendril を構成します（プロジェクト、エージェント、レベル、検証ゲート、各種設定）。
icon: Construction
searchHints:
  - config
  - yaml
  - 設定
  - プロジェクト
  - gui
  - デプロイ
  - docker
  - シークレット
  - BasicAuth
  - パスワード
  - ホスティング
---

# セットアップと設定

## アプリ内設定

Tendril には、[YAML](https://yaml.org) を手動で編集することなく環境を視覚的に構成できる専用の設定アプリが含まれています。設定サイドバーには以下のセクションがあります：

- **コーディングエージェント (Coding Agent)** — プライマリコーディングエージェントランタイム（[Claude Code](../06_CodingAgents/01_ClaudeCode.md)、[Copilot](../06_CodingAgents/03_Copilot.md)、[Codex](../06_CodingAgents/02_Codex.md)、[Gemini](../06_CodingAgents/05_Gemini.md)、Antigravity、[OpenCode](../06_CodingAgents/04_OpenCode.md)、Cursor、Apple、またはカスタムの OpenAI 互換プロキシ）を選択し、プロバイダー API キーやカスタムベース URL を構成し、エージェントプロファイルや推論層をカスタマイズし、エージェントの接続性をテストし、モデルカタログを介してモデル仕様を参照します。エージェントのインストールとセットアップについては、[コーディングエージェント](../06_CodingAgents/_Index.md) を参照してください。
- **計画 (Plans)** — [計画](../04_Apps/03_Plans.md) で新しい計画が作成されるたびに使用されるデフォルトの Markdown 計画テンプレート（`planTemplate`）を編集します。
- **外観 (Appearance)** — テーマモード（**Light**、**Dark**、または **System**）を選択し、プレビュー付きの組み込みテーマプリセットから選択し、デフォルトのサイドバー状態（展開または折りたたみ）を構成し、Chat ボタンのターゲット（**Chat ビュー** または **ターミナル**）を選択します。
- **プロジェクト (Projects)** — 登録済みプロジェクトの管理、プロジェクトごとのリポジトリ、検証ゲート、ポート、環境変数、カスタムスキル、[MCP](../09_Advanced/03_MCP.md) サーバーの構成、および Danger Zone へのアクセスを行います。[プロジェクト設定](02_Projects.md) を参照してください。
- **チーム Vault (Team Vault)** _(ベータ)_ — 共有 [Git](https://git-scm.com) リポジトリを介して、プロジェクト、カスタムスキル、MCP サーバー、およびセキュリティルールをチームメンバー間で同期します。
- **ワークフローエージェント (Workflow Agents)** — [プロンプトウェア](../02_Concepts/02_Promptwares.md) エージェントプロファイルと、標準ワークフロー（`CreatePlan`、`ExecutePlan`、`UpdatePlan` など）全体または `_default` キーを使用したグローバルなきめ細かなツール権限（`allowedTools`、`deniedTools`）を構成します。
- **レベル (Levels)** — 相対的な実行ウェイト、説明、およびカスタムバッジ色を使用して複雑度階層（L1、L2、L3 など）を定義します。
- **通知 (Notifications)** — ジョブの完了および失敗に対するデスクトップシステム通知のオン/オフを切り替えます。
- **セキュリティとトンネリング (Security & Tunneling)** — Web セッションのパスワード保護を設定し、リモートアクセス用のフルアクセス [Cloudflare](https://www.cloudflare.com) トンネルを開始または停止し、ケーパビリティトークンで保護された読み取り専用共有トンネルを作成します。
- **高度な設定 (Advanced)** — 実行タイムアウト（`jobTimeout`、`staleOutputTimeout`）の設定、`maxConcurrentJobs` の構成、ベータ機能アクセスの切り替え、およびライブの **デーモン診断 (Daemon Diagnostics)**（接続状態、PID、レイテンシ ping、`$TENDRIL_HOME` パス、および報告されたケーパビリティ）の確認を行います。
- **ニュースレター (Newsletter)** — Ivy & Tendril の製品アップデートやリリースノートを購読します。
- **config.yaml を開く (Open config.yaml)** — リアルタイムの構文ハイライトと直接的な計画リンク機能を備えた、組み込みの生 YAML エディタを起動します。

## `config.yaml`

UI で変更された設定は、直ちに `$TENDRIL_HOME/config.yaml`（デフォルトは `~/.tendril/config.yaml`）に永続化されます。このファイルを直接編集することも、`TENDRIL_CONFIG` 環境変数を使用してカスタムパスを指定することもできます。

> [!NOTE]
> 設定ファイルの名前は常に `config.yaml` である必要があります。Tendril デーモンは、ディスク上でファイルが更新されると設定変更を自動的に再読み込みします。

### 例

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Global Engine
    color: Emerald
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: CheckResult
        required: true

auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Managed via Settings
  hashSecret: "base64-secret-pepper"

api:
  apiKey: "your-api-secret-key"
```

### 一般的なフィールド

| フィールド             | 型           | デフォルト  | 目的                                                                                                                    |
| ---------------------- | ------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `codingAgent`          | string       | `"claude"`  | デフォルトのコーディングエージェント実行可能ファイル。[コーディングエージェント](../06_CodingAgents/_Index.md) を参照。 |
| `maxConcurrentJobs`    | integer      | `20`        | 同時実行エージェント [ジョブ](../04_Apps/04_Jobs.md)（ワークツリー）の最大数。                                          |
| `jobTimeout`           | integer (分) | `30`        | アクティブなジョブがキャンセルされるまでの実行タイムアウト（分単位）。                                                  |
| `staleOutputTimeout`   | integer (分) | `10`        | エージェントプロセスが stdout/stderr 出力を生成しない場合のタイムアウト（分単位）。                                     |
| `daemonRequestTimeout` | integer (秒) | `30`        | ローカルデーモンと通信する際のクライアントリクエストタイムアウト（秒単位）。                                            |
| `planTemplate`         | string       | `""`        | [計画](../04_Apps/03_Plans.md) で新しい計画を作成する際に使用される Markdown テンプレート。                             |
| `theme`                | string       | `"default"` | 外観プリセット識別子（例：`default`、`dracula`）。                                                                      |
| `themeMode`            | string       | `"system"`  | テーマモード：`light`、`dark`、または `system`。                                                                        |
| `chatMode`             | string       | `"chat"`    | Chat ボタンが開く対象：`chat`（Chat ビュー）または `terminal`（エージェントターミナル）。                               |
| `desktopNotifications` | boolean      | `true`      | ジョブイベントに対してデスクトップ OS 通知を有効にするかどうか。                                                        |
| `projects`             | list         | `[]`        | 登録されたプロジェクトとその構成のリスト。[プロジェクト設定](02_Projects.md) を参照。                                   |
| `levels`               | list         | standard    | 構成された計画の複雑度階層とウェイト。                                                                                  |
| `auth`                 | object       | `null`      | [Argon2](https://en.wikipedia.org/wiki/Argon2) を使用したセッションパスワード保護構成。                                 |
| `api.apiKey`           | string       | `null`      | REST API エンドポイントを保護する共有シークレット。[REST API](../09_Advanced/02_REST.md) を参照。                       |
| `telemetry`            | boolean      | `null`      | 匿名の使用状況テレメトリのオプトイン（`false` または未設定はオフ）。                                                    |

## 認証とリモートアクセス

### セッション保護（Web UI）

Tendril をリモートサーバーでホストする場合やネットワーク経由で公開する場合は、**Settings > Security & Tunneling** でセッション保護を有効にするか、環境変数を介して資格情報を構成します：

- `TENDRIL_AUTH_USERNAME` — ログインユーザー名（デフォルト：`admin`）。
- `TENDRIL_AUTH_PASSWORD` — 起動時にハッシュ化される平文パスワード。
- `TENDRIL_AUTH_HASH_SECRET` — [Argon2](https://en.wikipedia.org/wiki/Argon2) のペッパーシークレットとして使用される 32 バイトの Base64 文字列（[OpenSSL](https://www.openssl.org) 経由の `openssl rand -base64 32`）。

`config.yaml` 内では、パスワードはオプションのレート制限とともに `auth:` ブロックの下に Argon2 PHC ハッシュとして保存されます：

```yaml
auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..."
  hashSecret: "base64-encoded-pepper"
  rateLimit:
    threshold: 3
    baseDelaySeconds: 1.0
    maxDelaySeconds: 60.0
```

### Cloudflare トンネル

Tendril は [Cloudflare](https://www.cloudflare.com) トンネル（`cloudflared`）と統合されており、受信ファイアウォールポートを開放することなくアプリケーションを安全に公開できます：

- **フルアクセストンネル (Full-Access Tunnel)**：完全な Tendril デーモンを公開します。セキュリティのため、Tendril はフルアクセストンネルを開始する前に、パスワードが設定されたセッション保護がアクティブであることを要求します。
- **共有トンネル (Share Tunnel)**：ケーパビリティトークンによって保護された読み取り専用トンネルを作成し、書き込みアクセスを公開することなく、関係者と [ダッシュボード](../04_Apps/01_Dashboard.md) および計画の進行状況を安全に共有できるようにします。

### REST API の保護

REST API は、`config.yaml` 内の `api.apiKey` 設定または `TENDRIL_API_KEY` 環境変数を介したトークン認証を使用します。設定されている場合、リクエストには `X-Api-Key` ヘッダーを含める必要があります。[REST API](../09_Advanced/02_REST.md) および [CLI 設定](../09_Advanced/01_CLI/06_Config.md) を参照してください。

## 検証ゲート (Verifications)

Tendril には、プロジェクトがパイプラインに組み込むことができる組み込みの検証ゲート定義が付属しています：

| 検証ゲート    | 説明                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| `Build`       | プロジェクトのビルドコマンドを実行し、コンパイルエラーがゼロであることを確認します。 |
| `Format`      | コードフォーマット規則を検証するか、変更されたファイルをフォーマットします。         |
| `Test`        | 計画の変更範囲に絞ったユニットテストまたは統合テストを実行します。                   |
| `Lint`        | 静的解析 / リンターを実行し、違反を報告します。                                      |
| `Screenshots` | 計画のアーティファクトディレクトリに UI スクリーンショットをキャプチャします。       |
| `CheckResult` | 最終的な実装が計画の仕様と一致していることを検証します。                             |

カスタム検証コマンド（`cargo test`、`pnpm test`、`pytest` など）は、`config.yaml` でグローバルに定義するか、[プロジェクト設定](02_Projects.md#verification-pipelines) 内で直接定義できます。CLI の検証コマンドについては、[CLI 検証](../09_Advanced/01_CLI/03_Verification.md) を参照してください。
