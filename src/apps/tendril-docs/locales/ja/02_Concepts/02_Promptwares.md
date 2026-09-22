---
title: プロンプトウェア
description: >-
  プロンプトウェアは各計画ステージの背後にある単一目的のワークフローエージェントであり、それぞれ独自のプロンプト、ツール、および長期記憶を持っています。
icon: Terminal
searchHints:
  - プロンプトウェア
  - エージェント
  - プロンプト
  - ツール
  - メモリ
  - allowedTools
  - プロファイル
  - customInstructions
  - レイヤー
---

# プロンプトウェア

プロンプトウェア（promptware）は、単一目的のワークフローエージェントを定義する指示、ツール、およびメモリを含むディレクトリです。デプロイされたコピーは `$TENDRIL_HOME/Promptwares/` の下にプロンプトウェアごとに配置されます：

- **Program.md** — システムプロンプト：エージェントの目標、段階的な手順、および実行ルール。
- **Tools/** — エージェントが実行中に呼び出すことができる実行可能スクリプトおよびユーティリティ。
- **Memory/** — 実行をまたいで保持される永続的な Markdown メモ。このフィードバックループにより、プロンプトウェアはコードベースの固有の特徴を学習し、エラーを繰り返すのではなく改善していくことができます。

Tendril は、設定されたコーディングエージェント（[Claude Code](../06_CodingAgents/01_ClaudeCode.md)、[Codex](../06_CodingAgents/02_Codex.md)、[Copilot](../06_CodingAgents/03_Copilot.md)、[Gemini](../06_CodingAgents/05_Gemini.md)、[OpenCode](../06_CodingAgents/04_OpenCode.md)、Antigravity、[Cursor](https://www.cursor.com) など）を通じてプロンプトウェアをディスパッチし、最小権限のツール権限で一度に 1 つのジョブを実行します。

## デプロイとレイヤー

Tendril にはプラットフォームに組み込まれた標準のプロンプトウェアセットが付属しています。チームは [config.yaml](../03_Configuration/01_Setup.md) でオーバーレイディレクトリを設定し、システムプロンプトを上書きしたり、独自のチームツールを提供したりすることもできます。

プロンプトウェアのデプロイまたは更新：

```bash
tendril promptware deploy
```

プロンプトウェアが出荷時のベースラインから実行されているか、チームオーバーレイから実行されているかを確認するには：

```bash
tendril promptware layers
# または特定のプロンプトウェアを確認：
tendril promptware layers ExecutePlan
```

## コアワークフローエージェント

| プロンプトウェア | 役割                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **CreatePlan**   | 短い概要、受信トレイ項目、または [GitHub](https://github.com) の issue から計画を下書きします。                           |
| **ExpandPlan**   | 簡単な計画を、フェーズを含む実装可能な仕様へと具体化します。                                                              |
| **UpdatePlan**   | レビュアーのフィードバック、チャット、インライン注釈に基づいて既存の計画を改訂します。                                    |
| **SplitPlan**    | 大きな計画を、より小さく独立したサブ計画に分割します。                                                                    |
| **ExecutePlan**  | 分離された [Git ワークツリー](https://git-scm.com/docs/git-worktree) を作成し、計画フェーズを実装してテストを実行します。 |
| **RetryPlan**    | ログや差分を活用して、検証に失敗した計画の修正を再試行します。                                                            |
| **CreatePr**     | [GitHub CLI](https://cli.github.com/) (`gh`) を使用して、ワークツリーの差分から GitHub プルリクエストを作成します。       |
| **CreateIssue**  | 計画の失敗、状態、またはトリアージリクエストを GitHub issues にプッシュします。                                           |
| **AddProject**   | 新しいプロジェクトを登録し、そのリポジトリパスを設定します。                                                              |
| **SetupProject** | プロジェクトのビルド、実行、検証方法を割り出して記録します。                                                              |
| **SyncRepo**     | プロジェクトのリポジトリをアップストリームブランチに合わせて最新の状態に更新します。                                      |

## 設定

各プロンプトウェアは [~/.tendril/config.yaml](../03_Configuration/01_Setup.md) の `promptwares:` キーの下で設定されます：

```yaml
promptwares:
  _default:
    profile: balanced

  CreatePlan:
    profile: deep
    allowedTools:
      - Read
      - Glob
      - Grep
      - Bash
      - Write(%PLANS_DIR%/**)
    deniedTools:
      - WebFetch
    customInstructions: |
      Always include acceptance criteria and verification gates in the plan.
```

| フィールド           | 必須   | 説明                                                                                                                                                         |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile`            | はい   | 使用するエージェントプロファイル — `quick`、`balanced`、または `deep`。プロファイルはエージェントごとのモデルとエフォートレベルにマッピングされます。        |
| `allowedTools`       | いいえ | 組み込みデフォルトに追加して付与するツール。`%PROMPTWARE_DIR%`、`%PLAN_DIR%`、`%PLANS_DIR%` 変数をサポートし、ツール権限のスコープを特定パスに限定できます。 |
| `deniedTools`        | いいえ | 他の設定で許可されている場合でも、明示的に拒否するツール。                                                                                                   |
| `customInstructions` | いいえ | 優先度オーバーライドマーカー付きでエージェントプロンプトに挿入される自由形式テキスト。                                                                       |

`_default` エントリはすべてのプロンプトウェアに適用されるベースラインであり、名前付きエントリによって上書きされます。

### カスタムインストラクション

`customInstructions` が設定されている場合、Tendril は明示的な優先度マーカーを付けてコンパイル済みファームウェアプロンプトの末尾に追加します。エージェントは、ファームウェアテンプレートとプロンプトウェア自体の `Program.md` の両方よりもこれを優先して従うよう指示されます。共有プログラムファイルを編集することなく、プロンプトウェア単位で動作を上書きしたい場合に使用します。

## 実行フロー

1. **コンテキスト** — `Program.md` をコンパイルし、計画、インライン注釈、プロジェクト設定、および `config.yaml` の `customInstructions` を添付します。
2. **ツールと権限** — `Tools/` および設定されたツール権限を公開し、`%...%` 変数を絶対パスに展開します。書き込み可能なディレクトリは、計画フォルダ、プロンプトウェアの `Memory/`、およびリポジトリの Git ワークツリーに厳格に制限されます。
3. **実行** — 分離されたワークツリー内で、コーディングエージェントをバックグラウンドジョブプロセスとして起動します。
4. **キャプチャとテレメトリ** — リアルタイム出力を `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/` にストリーミングし、デーモンに進捗を送信し、計画の `costs.csv` にトークン使用量とコストを記録します。

## メモリと学習

メモリはフィードバックループです。プロンプトウェアはプロジェクトや障害モードについて学んだ内容を書き留め、将来の実行時にそれを読み戻します。CLI はメモリ管理を直接公開しています：

```bash
# プロンプトウェアに保存されているメモリメモを一覧表示
tendril promptware list-memory ExecutePlan

# 特定のメモを読み取る
tendril promptware read-memory ExecutePlan worktree-hygiene.md

# ファイル（または標準入力）からメモリメモを書き込みまたは更新
tendril promptware write-memory ExecutePlan worktree-hygiene.md --file notes.md

# 時代遅れになった、または誤ったメモリメモを削除
tendril promptware delete-memory ExecutePlan worktree-hygiene.md
```

> [!TIP]
> メモリは蓄積するだけでなく整理されるべきです。時代遅れになった前提やルールは、矛盾するメモの下に埋もれさせるのではなく、`delete-memory` で削除してください。

## 直接実行

デーモンジョブサービスをバイパスして、フォアグラウンドでプロンプトウェアを直接テストまたは実行するには：

```bash
# タスクプロンプトを指定して CreatePlan を直接実行
tendril promptware run CreatePlan "Add a health-check endpoint" --profile deep

# エージェントを起動せずにコンパイルされたファームウェアプロンプトを表示
tendril promptware run CreatePlan "Add a health-check endpoint" --dry-run
```

## 次のステップ

- [ライフサイクルとジョブ](03_Lifecycle.md) — プロンプトウェアの実行中に何が起こるか。
- [計画](01_Plans.md) — すべてのプロンプトウェアが読み書きするアーティファクト。
