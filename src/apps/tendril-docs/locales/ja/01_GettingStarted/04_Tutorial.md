---
title: チュートリアル
description: >-
  完全なエンドツーエンドのウォークスルー：Tendril をビルドし、ローカルリポジトリを登録し、最初の計画を作成し、エージェントで実行し、結果をレビューしてプルリクエストを作成します。
icon: GraduationCap
searchHints:
  - チュートリアル
  - ガイド
  - クイックスタート
  - 最初の計画
  - エンドツーエンド
  - 例
---

# チュートリアル

これは、お好みのリポジトリで行う完全なエンドツーエンドのワークフローです。プロジェクトの登録、計画の生成、分離されたワークツリーでの変更の実行、差分のレビュー、プルリクエストの作成までを網羅しています。

## ステップ 1：ビルドと確認

[インストール](02_Installation.md) の手順に従って Tendril をインストールまたはビルドし、`tendril` を `PATH` に配置します。環境を確認します：

```bash
tendril doctor
```

`tendril doctor` は、`$TENDRIL_HOME`、`config.yaml`、[SQLite](https://www.sqlite.org) データベース、plans ディレクトリ、[Git](https://git-scm.com/)、および [GitHub CLI](https://cli.github.com/) (`gh`) を検査します。次に進む前に、すべての `[FAIL]` 項目を解決してください。

## ステップ 2：Tendril の起動

デスクトップアプリケーションを起動します：

```bash
pnpm dev:desktop
```

デスクトップアプリが起動し、バックグラウンドで `tendril run` デーモンを自動的に監視します。デーモンは、デスクトップ UI と CLI が通信するための REST および WebSocket API を公開します。

デーモンをヘッドレスで実行したい場合：

```bash
# ポートを確認し、保留中のマイグレーションを実行
tendril run

# またはカスタムオプションを指定してダイレクトリスナーを実行：
tendril serve --host 127.0.0.1 --port 5010
```

## ステップ 3：リポジトリの登録

Tendril は作業対象のローカル Git リポジトリを必要とします：

```bash
git clone https://github.com/your-org/your-repo.git
```

デスクトップアプリの **Settings → Projects** からプロジェクトを登録するか、CLI 経由で登録します：

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

どちらの方法でも `$TENDRIL_HOME/config.yaml` が更新されます。手動で編集することも可能です：

```yaml
codingAgent: claude

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

`codingAgent` をインストール済みのエージェントに設定します：

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models（オンデバイス `fm` を経由した `apple`）

> [!TIP]
> リポジトリのルートに、アーキテクチャの規則やビルドコマンドを記載した `AGENTS.md` ファイルを追加してください。Tendril は毎回の実行時にこれをエージェントのシステムコンテキストに注入します。推奨事項については [コードベースのオンボーディング](03_Onboarding.md) を参照してください。

## ステップ 4：計画の作成

デスクトップアプリで **New Plan** をクリックし、タスクの説明を入力します。Tendril は [CreatePlan](../02_Concepts/02_Promptwares.md) ワークフローエージェントをディスパッチし、問題定義、段階的な解決策、検証ターゲットを含む構造化された計画を下書きします。

CLI から計画を作成することもできます：

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

計画は **Draft**（下書き）状態に入ります。計画の下書きを開き、提案された仕様を確認します。UI 内で直接インライン注釈を追加してスコープを修正したり制約を追加したりでき、[UpdatePlan](../02_Concepts/02_Promptwares.md) がフィードバックを統合して改訂版を作成します。

## ステップ 5：計画の実行

下書きが要件を満たしたら、**Execute** をクリックします（または `tendril plan execute <plan-id>` を実行します）。[ExecutePlan](../02_Concepts/02_Promptwares.md) エージェントは次の処理を行います：

1. `Worktrees/{repo-name}/` の下に分離された [Git ワークツリー](https://git-scm.com/docs/git-worktree) を作成し、プライマリブランチには手を触れません。
2. 計画の仕様、リポジトリのコンテキスト、およびメモリノートを読み込みます。
3. インクリメンタルな Git コミットを行いながら、フェーズごとにコードの変更を実装します。
4. 設定された各検証ゲート（ビルド、lint、テスト、スクリーンショット）を実行します。

デスクトップの **Jobs** ビューまたは CLI 経由で実行状況をリアルタイムに監視できます：

```bash
tendril job list          # ジョブステータスを表示
tendril job queue         # ディスパッチキューの順序を確認
```

すべてのフェーズが完了し、必要な検証に合格すると、計画は **Review**（レビュー）状態に移行します。

> [!NOTE]
> 検証チェックが失敗した場合、計画は **Failed**（失敗）状態になり、ワークツリーはディスク上に保持されます。`Verification/` の下にあるエラーレポートを確認するか、[RetryPlan](../02_Concepts/02_Promptwares.md) を実行してエージェントに問題の修正を任せます。

## ステップ 6：結果のレビュー

計画の **Review** 画面に移動し、作業成果を確認します：

- **Git 差分** — 影響を受けたファイル全体のシンタックスハイライト付き差分を閲覧。
- **検証レポート** — 自動ビルドおよびテストの出力を確認。
- **実行トランスクリプト** — ツール呼び出しのトレース、標準出力/標準エラー出力、トークンコストを確認。
- **フォローアップの推奨事項** — エージェントによって指摘された技術的負債や改善点を確認。

問題がなければ計画を承認します。Tendril は [CreatePr](../02_Concepts/02_Promptwares.md) をトリガーして [GitHub CLI](https://cli.github.com/) (`gh`) 経由でプルリクエストを作成し、計画を **Completed**（完了）に移行します。

## 行われた処理のまとめ

標準的な Tendril 開発ループを完了しました：

```
Draft → Creating → Executing → Review → Completed
```

自律エージェントはサンドボックス化されたワークツリー内で動作し、検証ゲートを満たし、監査可能なプルリクエストを作成しました。その間、すべてのプロンプト、差分、コストは `$TENDRIL_HOME/Plans/` の下に記録されました。

## 次のステップ

- [計画](../02_Concepts/01_Plans.md) — 計画の構造、状態、注釈についての詳細。
- [プロンプトウェア](../02_Concepts/02_Promptwares.md) — ワークフローエージェントのプロンプト、ツール、メモリのカスタマイズ。
- [ライフサイクルとジョブ](../02_Concepts/03_Lifecycle.md) — 並行性、キューイング、テレメトリの理解。
