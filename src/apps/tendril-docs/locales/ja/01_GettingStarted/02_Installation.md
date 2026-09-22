---
title: インストール
description: ビルド済みバイナリまたはソースからのビルドによる Tendril のインストール、デスクトップアプリと CLI の実行、および環境設定について説明します。
icon: Download
searchHints:
  - インストール
  - ビルド済みバイナリ
  - ソースからのビルド
  - 前提条件
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - アップデート
---

# インストール

Tendril は、ビルド済みのデスクトップパッケージおよび CLI バイナリを使用してインストールするか、ソースからローカルでビルドすることができます。

## クイックインストール

スタンドアロンのデスクトップインストーラー（`.dmg`、`.pkg`、`.exe`、`.AppImage`、`.deb`）を [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) から直接ダウンロードするか、以下の自動インストールスクリプトのいずれかを実行してください：

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

インストーラーは `tendril` CLI バイナリを `PATH` に配置し、デスクトップアプリケーションをシステムメニューに登録します。

## 前提条件（ソースからビルドする場合）

ソースからビルドする場合は、以下の依存関係がインストールされ、`PATH` で利用可能であることを確認してください：

| ツール                                       | バージョン           | 役割                                                                                        |
| -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (2021 edition) | ネイティブ CLI、サーバーデーモン、コアをコンパイルします。                                  |
| [Node.js](https://nodejs.org/)               | 22 以降              | フロントエンドツールおよびビルドスクリプトを実行します。                                    |
| [pnpm](https://pnpm.io/)                     | 11 以降              | ワークスペースのパッケージと依存関係を管理します。                                          |
| [Vite+](https://viteplus.dev/) (`vp`)        | 最新                 | ビルド、lint、フォーマット、テストをオーケストレーションします。                            |
| [Git](https://git-scm.com/)                  | 2.30+                | [Git ワークツリー](https://git-scm.com/docs/git-worktree)、コミット、ブランチを管理します。 |
| [GitHub CLI](https://cli.github.com/) (`gh`) | 認証済み             | プルリクエストの作成や issue の管理を自動化します。                                         |

また、少なくとも 1 つの認証済みコーディングエージェント CLI（[Claude Code](https://code.claude.com/docs)、[GitHub Copilot](https://github.com/features/copilot)、[Gemini](https://ai.google.dev)、[OpenCode](https://opencode.ai)、[Antigravity](https://github.com/google-deepmind)、[Cursor](https://www.cursor.com) など）が必要です。エージェントの設定については [コードベースのオンボーディング](03_Onboarding.md) で詳しく説明しています。

## ソースからのビルド

リポジトリをクローンし、ワークスペースの依存関係をインストールします：

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # デスクトップアプリに必要な共有 UI ライブラリ
node src/scripts/ensure-wireframe-payload.mjs      # ネイティブビルド用のワイヤーフレームアセットを準備
cargo build --workspace                            # tendril-core、tendril-server、tendril-cli をビルド
```

> [!NOTE]
> `tendril-app` と `tendril-wireframe` はビルド時にこれらのアセットをインポートするため、ネイティブワークスペースクレートをコンパイルする前に `@ivy-interactive/components` ライブラリとワイヤーフレームペイロードを生成する必要があります。

## デスクトップアプリの実行

ホットモジュールリロード（HMR）を使用したローカル開発の場合：

```bash
pnpm dev:desktop
```

このコマンドは必要なサイドカーバイナリをビルドし、[Tauri 2](https://tauri.app) ネイティブウィンドウとともに Vite を起動します。デスクトップアプリはバックグラウンドデーモン（`tendril run`）を自動的に管理します。

### スタンドアロンリリースのパッケージング

お使いのプラットフォーム向けのスタンドアロンリリースバンドルをパッケージ化するには：

```bash
cargo build --release --bin tendril

# ターゲットアーキテクチャ用のネイティブ CLI サイドカーをステージング
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# バンドルされた OpenCode サイドカーエージェントを取得
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# インストーラーパッケージをビルド（macOS は DMG、Windows は NSIS/MSI、Linux は AppImage/deb）
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## CLI のインストール

`tendril` バイナリは、コマンドラインインターフェースとデーモンサーバーの両方として機能します：

```bash
cargo build --release --bin tendril
# または ~/.cargo/bin に直接インストール：
cargo install --path src/crates/tendril-cli
```

ヘルスチェック doctor でインストールを確認します：

```bash
tendril version
tendril doctor
```

`tendril doctor` は、`$TENDRIL_HOME`、`config.yaml` の構文、[SQLite](https://www.sqlite.org) データベース、plans ディレクトリ、および `git` と `gh` の認証情報を検証します。

### ヘッドレスでのデーモン実行

デスクトップ UI なしで Tendril をヘッドレスサーバーデーモンとして実行するには：

```bash
# 推奨：ポートの可用性をチェックし、保留中のデータベースマイグレーションを実行
tendril run

# またはダイレクトリスナーを実行（--tls-cert および --tls-key をサポート）
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> サーバーはデフォルトで `127.0.0.1:5010` をリスンし、REST および WebSocket エンドポイントを公開します。静的な Web インターフェースは提供しません。デスクトップアプリまたは CLI 経由で操作してください。

## 設定とディレクトリ構成

すべての Tendril ランタイム状態は `$TENDRIL_HOME` 内に保存され、以下の優先順位で解決されます：

1. `TENDRIL_HOME` 環境変数
2. `~/.tendril_location` に記録されたパス（存在する場合）
3. デフォルトのユーザーロケーション：`~/.tendril`

`$TENDRIL_HOME` の内部構成：

```
~/.tendril/
├── config.yaml     # コーディングエージェント、プロジェクト定義、検証、プロンプトウェアの上書き
├── tendril.db      # ジョブ、コスト、実行テレメトリ用の SQLite データベース
├── Plans/          # 構造化された計画と分離された Git ワークツリー
├── Jobs/           # 実行ログ、エージェントプロンプト、生の文字起こし記録
└── Promptwares/    # デプロイされたワークフローエージェント定義
```

最小限の `config.yaml`：

```yaml
codingAgent: claude
maxConcurrentJobs: 20

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

エージェント定義を初期化するために標準プロンプトウェアをデプロイします：

```bash
tendril promptware deploy
```

> [!WARNING]
> 最初のジョブを開始する前に、選択したコーディングエージェント CLI が認証されていることを確認してください。無人のバックグラウンドプロセスでエージェントが一時停止して認証情報を求めた場合、ジョブがブロックされるかタイムアウトします。

## アップデート

インストールスクリプトでインストールした場合は、ワンライナーを再実行して最新リリースを取得してください。

ソースチェックアウトから作業している場合：

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## 次のステップ

- [コードベースのオンボーディング](03_Onboarding.md) — リポジトリの前提条件を設定し、エージェントのアクセスを確認します。
- [コンセプト：計画](../02_Concepts/01_Plans.md) — 計画の構造とレビューライフサイクルを理解します。
- [トラブルシューティング](06_Troubleshooting.md) — ビルドおよびランタイムエラーの解決策。
