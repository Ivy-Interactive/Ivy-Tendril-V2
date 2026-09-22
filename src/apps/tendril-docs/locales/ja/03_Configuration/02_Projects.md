---
title: プロジェクト設定
description: 各プロジェクトは独自の検証ゲートとエージェントコンテキストを持つ Git リポジトリです。Tendril は多数のプロジェクトを並行して実行できます。
icon: FolderGit
searchHints:
  - プロジェクト
  - レポ
  - リポジトリ
  - マルチプロジェクト
  - 分離
  - ワークツリー
  - デンジャーゾーン
  - mcp
  - サンドボックス
---

# プロジェクト設定

Tendril は複数のプロジェクトの並行管理をサポートしています。各プロジェクトは独自の [Git](https://git-scm.com) リポジトリ、検証ゲート、ポート割り当て、環境変数、セキュリティサンドボックス、およびカスタムスキルを定義します。

## プロジェクトの追加と管理

プロジェクトは、**Settings > Projects** で視覚的に構成するか、`$TENDRIL_HOME/config.yaml` 内で宣言することによって構成できます（[セットアップと設定](01_Setup.md) を参照）：

- **プロジェクト追加ウィザード (Add Project Wizard)** — 設定サイドバーの **Add Project** をクリックして、リポジトリパス、初期カラー、およびデフォルトの検証ゲートを指定してプロジェクトを登録します。
- **インライン名前変更 (Inline Renaming)** — ヘッダーのプロジェクト名の横にある鉛筆アイコンをクリックして、プロジェクトの名前を変更します。Tendril は重複する兄弟名がないかを検証し、関連する計画レコードを自動的に更新します。
- **カラースウォッチピッカー (Color Swatch Picker)** — 32 色の Ivy カラーパレットスウォッチグリッド（`ColorSwatchField`）からアクセントカラーを選択します。この色は、[ダッシュボード](../04_Apps/01_Dashboard.md)、[計画](../04_Apps/03_Plans.md) キュー、[レビュー](../04_Apps/02_Review.md) キュー、および [プルリクエスト](../04_Apps/06_PullRequests.md) トラッカー全体でプロジェクトを識別するために使用されます。
- **コンテキスト (Context)** — ドメインの用語、アーキテクチャ上の制約、コーディング標準を記述した Markdown 形式の指示。このコンテキストは、プロジェクト上のすべてのエージェント実行時にプロンプトウェアの指示の先頭に追加されます。

### `config.yaml` の例

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Core engine services written in Rust with a TypeScript CLI.
      Follow standard Ivy design tokens and ensure all tests pass.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
    reviewActions:
      - name: Run E2E
        command: pnpm test:e2e
        condition: "${hasChanges}"
    ports:
      backend:
        defaultPort: 8080
        description: API gateway service
    envFiles:
      - path: .env
        template: .env.example
        overrides:
          PORT: "${ports.backend}"
          DATABASE_URL: "sqlite://${env.TENDRIL_HOME}/dev.db"
    wireframes: true
    wireframeGuard: true
    sandboxMode: Off
    securityPreset: Standard
```

## リポジトリと Git ワークツリー

Tendril プロジェクトは 1 つ以上の [Git](https://git-scm.com) リポジトリ（`repos:`）をリンクします。

エージェントが `ExecutePlan` を介して計画を実行すると、ローカルの開発環境からコード生成が分離されます：

- **専用の Git ワークツリー** — Tendril は、ターゲットブランチから分岐した分離された Git ワークツリーブランチ（`tendril/<planId>-<slug>`）を作成します。作業ツリー、現在のブランチ、および IDE は影響を受けません。
- **並行実行** — 複数の計画を、git ロックの競合を起こすことなく異なるリポジトリにわたって同時に実行できます。
- **安全な失敗と破棄** — 失敗または拒否された実行は、手動での git クリーンアップを必要とせずにクリーンに破棄できます。
- **ワークツリーリーパー (Worktree Reaper)** — [セットアップと設定](01_Setup.md) の `worktreeReaperInterval` および `worktreeReaperGrace` 設定に従って、自動バックグラウンドクリーンアップがアイドル状態または完了したワークツリーを回収します。

## 検証パイプライン

プロジェクトは、作業が [レビュー](../04_Apps/02_Review.md) に到達する前にエージェントが満たさなければならない検証ゲートの順序付けられたシーケンスを定義します：

- **並べ替え可能な順序** — 検証ステップをドラッグ＆ドロップして希望の実行順序に配置します（`SortableVerificationList`）。
- **必須ゲート** — 検証を必須（required）としてマークします。すべての必須検証が成功した場合にのみ、計画は [レビュー](../04_Apps/02_Review.md) で `Verified`（検証済み）と表示されます。
- **カスタム検証** — プロジェクト固有のコマンドやカスタム検証プロンプト（例：`cargo clippy`、`pnpm check`、`pytest`）を追加します。コマンドライン管理については、[CLI 検証](../09_Advanced/01_CLI/03_Verification.md) を参照してください。

## レビューアクション (Review Actions)

[レビュー](../04_Apps/02_Review.md) アプリのツールバーにレンダリングされるワンクリックアクションボタンを定義します（`reviewActions:`）：

- `name` — ツールバーボタンに表示されるアクションラベル。
- `command` — 計画のワークツリー内で実行されるシェルコマンド。
- `condition` — オプションの実行条件（`${hasChanges}` など）。

## ポートと環境変数ファイル

複雑なプロジェクトでは、分離されたポートと環境構成が必要になることがよくあります：

- **ポート割り当て (`ports:`)** — 名前付きポート（例：`backend`、`frontend`）を宣言します。デフォルトのポートがすでに使用されている場合、Tendril は空いているポートを割り当て、`${ports.<name>}` プレースホルダーを介して公開します。
- **環境変数ファイル (`envFiles:`)** — ベーステンプレート（例：`.env.example`）と、`${ports.<name>}`、`${env.<VAR>}`、および `%VAR%` 変数をサポートする行ごとのキー/値の上書きから、エージェントワークツリー内に `.env` ファイルを自動的に再作成します。

## エージェントセキュリティとサンドボックス

Tendril は、きめ細かなプロジェクトレベルのセキュリティ制御を提供します：

- **セキュリティプリセット** — `Strict`、`Standard`、`Permissive`、または `Custom` を選択します。プリセットはデフォルトのサンドボックスとファイルアクセスルールを構成します。
- **サンドボックスモード** — ランタイム分離を選択します：`Off`、[Docker](https://www.docker.com)、または [Bubblewrap](https://github.com/containers/bubblewrap)。
- **外部ファイルアクセス** — エージェントがリポジトリツリーの外部にあるファイルを読み取ることを許可するかどうかを制御します（`Deny`、`ReadOnly`、`Full`）。
- **ターミナル自動実行** — エージェントがシェルコマンドを自動的に実行するか（`AllowAll`）、確認を求めるか（`RequireConfirmation`）、コマンド実行を拒否するか（`DenyAll`）を選択します。
- **ファイル権限** — 詳細なパスルールを構成します：`Allow <path>`、`Ask <path>`、または `Deny <path>`。
- **ワイヤーフレームとワイヤーフレームガード** — `wireframes` を切り替えて計画での UI プロトタイプ生成を有効にし、`wireframeGuard` を切り替えて本番プルリクエストにマージされる前に一時的なワイヤーフレームコードがチェックされていることを検証します。

## プロジェクト MCP サーバーとスキル

特定のプロジェクト向けにエージェント機能を拡張します：

- **MCP サーバー (`mcpServers:`)** — カスタム実行可能ファイル、引数、環境変数を使用して、プロジェクトスコープの [Model Context Protocol](https://modelcontextprotocol.io) サーバーを登録します。[MCP 統合](../09_Advanced/03_MCP.md) を参照してください。
- **スキル (`skills:`)** — プロジェクト固有の手順と Markdown の指示をエージェントに提供します。[スキルガイド](../06_CodingAgents/00_Skills.md) を参照してください。

## リポジトリローカルのコンテキスト

Tendril は、リポジトリのルートにあるドキュメントを自動的に検出し、プロンプトウェアコンテキストの先頭に追加します：

- **`CLAUDE.md`** — Claude Code 向けのガイダンスと規約。[Claude Code ガイド](../06_CodingAgents/01_ClaudeCode.md) を参照。
- **`AGENTS.md` / `DEVELOPER.md`** — チームの開発標準、テスト要件、およびコードベースの規約。

## Danger Zone：削除 (Remove) vs 完全消去 (Delete)

プロジェクト設定の最後には、Danger Zone に 2 つの異なる破棄オプションが用意されています：

```
[ Remove Project ]  (アウトライン)
config.yaml からプロジェクトを登録解除します。クローンされたリポジトリ、計画フォルダー、
および履歴はディスク上に残るため、同じ名前でプロジェクトを再度追加すれば復元されます。

[ Delete Project ]  (破壊的)
プロジェクトの計画、<TENDRIL_HOME>/Projects/ 下のクローンされたリポジトリ、
データベースの行、および設定エントリを完全に消去します。これは取り消すことができず、
確認のためにプロジェクト名を入力する必要があります。
```

> [!WARNING]
> **Remove Project** は、ディスク上のファイルをそのまま保持しながら構成からプロジェクトの登録を解除するだけです。**Delete Project** は、リポジトリ、計画、およびデータベースレコードを完全に消去するため、確認のために正確なプロジェクト名を入力する必要があります。
