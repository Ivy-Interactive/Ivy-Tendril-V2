---
title: コードベースのオンボーディング
description: Tendril が無人で変更の計画、実行、検証、出荷を行えるように、開発マシンとリポジトリを準備するためのチェックリスト。
icon: ClipboardCheck
searchHints:
  - オンボーディング
  - チェックリスト
  - 準備
  - 開発マシン
  - 環境
  - ワークツリー
  - AGENTS.md
  - gh
  - mcp
---

# コードベースのオンボーディング

Tendril は、分離された [Git ワークツリー](https://git-scm.com/docs/git-worktree) 内でリポジトリに対してコーディングエージェントを実行し、ビルド、テスト、プルリクエストの作成を行います。このループを人間の介入なしに成功させるには、マシンとリポジトリをあらかじめ設定しておく必要があります。マシンごとに 1 回、コードベースごとに 1 回、以下のチェックリストを実施してください。

> [!TIP]
> 完了したら `tendril doctor` を実行してください。Tendril home、`config.yaml`、データベース、plans ディレクトリ、`git`、および `gh` が確認されます。コーディングエージェントはテスト**されません**。以下のステップ 2 で自身で検証してください。

## マシンのチェックリスト

### 1. 必要なビルドソフトウェアがインストールされていること

プロジェクトのコンパイルに必要なすべてのツールがインストールされ、`PATH` で利用可能である必要があります。エージェントは実行の途中で不足しているコンパイラや SDK をインストールすることはできません。Tendril 自体のような Rust と pnpm のリポジトリの場合、[Rustup](https://rustup.rs/)、[Node.js](https://nodejs.org/)、[pnpm](https://pnpm.io/) が必要です。独自のプロジェクトの場合は、スクリプトが呼び出すビルドツールチェーンが対象となります。

> [!NOTE]
> 目標とする要件：クリーンなターミナルからドキュメント化されたコマンドを使用して、対話的なプロンプトや IDE 専用の手動手順なしで、新しくクローンしたリポジトリがビルドできること。

### 2. 推奨コーディング CLI がインストールされ、認証されていること

`config.yaml` の `codingAgent` に設定したエージェントをインストールし、非対話形式で実行できるようにログインします：

```bash
# 例：Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

CLI が `PATH` に存在し、通常の呼び出しで認証情報を求めるプロンプトで停止しないことを確認します：

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor` / `cursor-agent`)
- Apple Foundation Models（オンデバイス `fm` を経由した `apple`）

`apple` エージェントは例外です。Apple のオンデバイスモデルに対してバンドルされた OpenCode を介して実行されるため、`fm` がインストールされていること（`fm available` で確認）、および `fm serve` プロセスがすでにリスンしていることを確認してください。

### 3. Git がインストールされ、無人使用が承認されていること

Tendril はユーザーに代わってコードのプル、ワークツリーの作成、コミット、プッシュを行います。すべての操作が対話型プロンプトなしで機能することを確認してください：

- グローバルな ID が設定されていること（`git config --global user.name` および `user.email`）。
- 認証情報ヘルパーまたはエージェントに読み込まれた SSH キーを介して認証情報がキャッシュされており、`git pull` および `git push` でパスワードが要求されないこと。
- ワークツリーの追加と削除ができること（`git worktree add` および `git worktree remove`）。

> [!WARNING]
> HTTPS 経由のプッシュで認証情報が要求される場合は、認証情報ヘルパーを設定するか、アクティブな `ssh-agent` で SSH キーを使用してください。対話型プロンプトが 1 つでもあると、本来無人で実行されるはずのジョブが停止してしまいます。

### 4. GitHub CLI がインストールされ、認証されていること

[CreatePr](../02_Concepts/02_Promptwares.md) は [GitHub CLI](https://cli.github.com/) (`gh`) を使用してプルリクエストを作成します。インストールして認証を確認してください：

```bash
gh auth login
gh auth status
```

### 5. 必要な MCP サーバーがグローバルにインストールされていること

課題のコンテキストを取得する Jira や UI デザイン用の Figma など、[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) サーバーを利用している場合は、すべてのワークツリーからアクセスできるようにグローバルにインストールして登録してください。MCP サーバーは Tendril 内部ではなく、コーディングエージェントに登録されます：

```bash
# 例：Claude Code 向けに MCP サーバーをグローバル登録
claude mcp add --scope user jira -- npx -y @your-org/jira-mcp
claude mcp add --scope user figma -- npx -y figma-developer-mcp
claude mcp list   # アクセス可能であることを確認
```

> [!NOTE]
> エージェントが作業する一時的な Git ワークツリーでも MCP サーバーが維持されるよう、プロジェクトスコープではなくグローバルまたはユーザースコープを使用してください。必要な API トークンはシステムの環境変数として保存してください。

単に登録されているだけでなく、各 MCP サーバーに対して実際に*認証*されていることを確認してください。Tendril から小さなテスト計画を実行し、OAuth モーダルをトリガーすることなくすべてのサーバーが初期化されることを確認します。

## リポジトリのチェックリスト

### 6. リポジトリがワークツリー対応であること

[ExecutePlan](../02_Concepts/02_Promptwares.md) は、アクティブな作業ディレクトリではなく、分離された [Git ワークツリー](https://git-scm.com/docs/git-worktree) 内で実行されます。ワークツリーはクリーンなコミットから開始されるため、`target/`、`node_modules/`、追跡されていない `.env` ファイルなどは存在しません。

- チェックアウト後、コードをコンパイルする前に必要なセットアップコマンド（依存関係の復元、コード生成、サンプルの `.env` コピーなど）を文書化し、コミット済みのセットアップスクリプトを用意してください。
- プライマリチェックアウトにのみ存在する未コミットのファイルに依存しないでください。
- パッケージを再ダウンロードするのではなく、各ワークツリーが数秒で復元できるように、集中キャッシュを備えたパッケージマネージャー（pnpm ストア、Cargo レジストリキャッシュ、Go モジュールキャッシュなど）を使用してください。

> [!TIP]
> クイックテスト：`git worktree add ../repo-probe` を実行し、クリーンなシェルからそのディレクトリ内で文書化されたビルドコマンドを実行します。コンパイルとテストに合格すれば、Tendril も成功します。テスト後は `git worktree remove ../repo-probe` で削除してください。

### 7. 各アプリケーション用の実行スクリプトを用意すること

リポジトリ内の各アプリケーションに対して、ポートを設定可能な小さくコミット済みの起動スクリプトを用意してください。Tendril はワークツリー全体で並行して複数の計画を同時に実行できるため、ハードコードされたポートは競合の原因になります。

[Vite](https://vite.dev) フロントエンドと Python API を組み合わせた場合、スクリプトは以下のようになります：

```bash
#!/usr/bin/env bash
# run.sh - Python バックエンド API と Vite フロントエンドを起動
set -euo pipefail

api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"

cd "$(dirname "$0")"

# バックエンド：仮想環境を設定し、依存関係をインストール
python -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# 専用ポートでバックエンド API を起動
uvicorn app.main:app --port "$api_port" &
api_pid=$!

# フロントエンドプロセス終了時にバックエンドを終了
trap 'kill "$api_pid" 2>/dev/null' EXIT

# フロントエンド：依存関係をインストールし、Vite 開発サーバーを起動
npm --prefix web install --prefer-offline --no-audit
npm --prefix web run dev -- --port "$web_port" --open
```

> [!NOTE]
> 起動コマンドをコミット済みスクリプトに保持することで、人間の開発者も自律ワークフローエージェントも全く同じ方法でアプリケーションを起動できます。

### 8. リポジトリのルートに AGENTS.md（または README.md）を追加すること

ワークフローエージェントが推測に頼らずにコードベースを把握できるよう、必要な基本コンテキストを提供します：

- コードのビルドと実行に必要な**前提条件**。
- アプリケーション、ライブラリ、通信プロトコルを詳細に説明した**アーキテクチャマップ**。
- リポジトリをコンパイルし検証する**ビルドおよびテストコマンド**。
- 前のステップの起動スクリプトを指定する**実行スクリプト**。

## 次のステップ

- [チュートリアル](04_Tutorial.md) でエンドツーエンドのループを体験します。
- [コンセプト：計画](../02_Concepts/01_Plans.md) および [プロンプトウェア](../02_Concepts/02_Promptwares.md) を確認します。
- [ジョブライフサイクル](../02_Concepts/03_Lifecycle.md) を理解します。
