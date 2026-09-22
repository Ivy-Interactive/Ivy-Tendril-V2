---
title: vault
description: チーム設定ボルトの管理、GitHub 上の共有リポジトリの検出と接続、カタログアセットの検査、プロジェクトのインポート、および CLI から直接の設定更新の公開を行います。
icon: KeyRound
searchHints:
  - vault
  - ボルト
  - sync
  - pull
  - import
  - push
  - catalog
  - discover
  - connect
  - auto-sync
  - team
---

# vault

[Git](https://git-scm.com) および [GitHub](https://github.com) をバックエンドとするチーム設定ボルトを管理します。ボルトを使用すると、チームはプロジェクト設定、カスタムスキル、[Model Context Protocol (MCP)](https://modelcontextprotocol.io) サーバー設定、プロンプトウェアメモリ、および検証をワークステーション間で共有できます。CLI は [GitHub CLI (`gh`)](https://cli.github.com) と連携して、チームリポジトリの検出、プロジェクトテンプレートのインポート、[GitHub Pull Requests](https://docs.github.com/en/pull-requests) を介した更新の送信を行います。

ローカルプロジェクト設定については [Projects](02_Project.md) を、グローバル設定については [Global Config](06_Config.md) を参照してください。

## Commands

```terminal
>tendril vault list [--json]
>tendril vault status [vault-id] [--json]
>tendril vault discover [--json]
>tendril vault connect <repo-url> [--name <custom-name>]
>tendril vault create <repo-name> [--public] [--org <org>]
>tendril vault disconnect [vault-id] [-y, --yes]
>tendril vault sync [vault-id]
>tendril vault pull [vault-id]
>tendril vault set-auto-sync <enabled> [--vault <vault-id>]
>tendril vault catalog [vault-id] [--json]
>tendril vault import <project-name> [options]
>tendril vault push <projects...> [options]
>tendril vault delete <project-name> [--vault <vault-id>] [-y, --yes]
```

## Vault Management

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

接続されているすべてのボルトを一覧表示し、その ID、名前、リモート [Git](https://git-scm.com) リポジトリ URL、アクティブブランチ、先行/遅行コミット数、最終同期タイムスタンプ、および自動同期ステータスを表示します。

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

未コミットのローカル変更やブランチ追跡状態など、特定のボルトまたはプライマリ設定ボルトの詳細な診断および同期ステータスを表示します。

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

[GitHub CLI (`gh`)](https://cli.github.com) を使用して [GitHub](https://github.com) をスキャンし、自身のアカウントや所属組織からアクセス可能な既存のボルトリポジトリを検出します。

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

既存の [Git](https://git-scm.com) リポジトリをチームボルトとして接続します。完全なリポジトリ URL または `org/repo` 省略記法を受け付けます。

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

[GitHub](https://github.com) 上に新しいリポジトリを作成し（デフォルトは private）、標準のボルトディレクトリレイアウトを初期化して、ローカルに接続します。組織を対象にするには `--org` を、公開リポジトリにするには `--public` を使用します。

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

ローカルのクローンディレクトリを削除せずに、ローカルの Tendril 設定からボルトの接続を解除します。確認プロンプトをスキップするには `-y` または `--yes` を渡します。

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

リモートボルトリポジトリから最新の設定コミットをプルし、追跡されているローカルプロジェクトを更新します。`pull` は `sync` のエイリアスです。

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

ボルトの自動同期を有効または無効にします。`true`、`false`、`1`、`0`、`yes`、または `no` を受け付けます。

## Catalog & Project Sharing

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

ボルトカタログに公開されているすべてのプロジェクトとアセット数（リポジトリ、カスタムスキル、[Model Context Protocol (MCP)](https://modelcontextprotocol.io) サーバー、プロンプトウェアメモリ、検証）を一覧表示します。

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

ボルトカタログからローカルの Tendril 設定にプロジェクト定義をインポートします。

| オプション             | 説明                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `--target-name <name>` | カタログ名の代わりに登録するカスタムローカルプロジェクト名                       |
| `--vault <vault-id>`   | インポート元のボルト ID または名前（デフォルト: アクティブなボルト）             |
| `--repo <name=path>`   | ボルトリポジトリ識別子をローカルファイルシステムパスにマッピング（複数指定可）   |
| `--no-permissions`     | セキュリティルールと実行権限のインポートをスキップ                               |
| `--merge`              | 既存のローカルプロジェクトを置き換えるのではなく、そのプロジェクトに設定をマージ |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

プロジェクト設定、カスタムスキル、[Model Context Protocol (MCP)](https://modelcontextprotocol.io) 設定、プロンプトウェアメモリ、検証を収集し、フィーチャーブランチにコミットして、ボルトリポジトリに対して [GitHub Pull Request](https://docs.github.com/en/pull-requests) を作成します。

| オプション            | 説明                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `--vault <vault-id>`  | 対象ボルト識別子                                                                                 |
| `--version <version>` | カスタムバージョン文字列（デフォルト: UTC タイムスタンプ）                                       |
| `--changelog <text>`  | プルリクエストの説明に含まれる変更履歴ノート                                                     |
| `--title <title>`     | 生成されるプルリクエストのカスタムタイトル                                                       |
| `--body <body>`       | プルリクエストのカスタム本文説明                                                                 |
| `--reviewer <names>`  | レビュアーとして割り当てる [GitHub](https://github.com) ユーザー名（複数可、カンマ区切りも可能） |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

ボルトリポジトリからプロジェクトを削除し、削除を適用するための [GitHub Pull Request](https://docs.github.com/en/pull-requests) を作成します。確認をスキップするには `-y` または `--yes` を渡します。

## Examples

**チームボルトの接続と同期:**

```terminal
># GitHub 上でアクセス可能なチームボルトを検出
>tendril vault discover

># ボルトリポジトリを接続
>tendril vault connect https://github.com/my-org/shared-vault.git

># 更新をプル
>tendril vault sync
```

**カタログからのプロジェクトのインポート:**

```terminal
># 利用可能なカタログプロジェクトを検査
>tendril vault catalog

># カスタムローカルリポジトリパスを指定してインポート
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**プルリクエストによるプロジェクト更新の公開:**

```terminal
># 変更をプッシュし、レビュアーを割り当ててプルリクエストを作成
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
