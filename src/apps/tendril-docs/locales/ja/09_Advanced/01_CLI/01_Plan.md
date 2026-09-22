---
title: plan
description: ターミナルから計画を作成、読み取り、更新、および検証します。すべてのサブコマンドは、環境変数が未設定の場合、TENDRIL_PLANS、TENDRIL_HOME/Plans、または ~/.tendril/Plans から計画フォルダーを解決します。
icon: ListChecks
searchHints:
  - plan
  - create
  - list
  - get
  - set
  - update
  - validate
  - repo
  - pr
  - commit
  - verification
  - recommendation
  - rec
  - log
  - revision
  - doctor
  - depends
  - related
  - env
  - wireframes
---

# plan

ターミナルから計画を作成、読み取り、更新、および検証します。すべてのサブコマンドは、環境変数が未設定の場合、`TENDRIL_PLANS`、`TENDRIL_HOME/Plans`、または `~/.tendril/Plans` から計画フォルダーを解決します。

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

新しい計画フォルダーと `Draft` 状態の `plan.yaml` スキャフォールドを作成します。計画 ID は `.counter` ファイルから自動割り当てされます。リポジトリとデフォルトの検証はプロジェクト設定から継承されます。

| オプション                      | 説明                                             |
| ------------------------------- | ------------------------------------------------ |
| `--level <level>`               | 優先度レベル（デフォルト: Feature）              |
| `--initial-prompt <text>`       | 初期プロンプトテキスト                           |
| `--source-url <url>`            | ソース URL（GitHub issue または PR）             |
| `--execution-profile <profile>` | 実行プロファイル（`deep` または `balanced`）     |
| `--priority <number>`           | 優先度数値（デフォルト: 0）                      |
| `--verification <Name=Status>`  | 検証エントリ（複数指定可）                       |
| `--related-plan <folder>`       | 関連計画フォルダー名（複数指定可）               |
| `--depends-on <folder>`         | 依存関係の計画フォルダー名（複数指定可）         |
| `--chat-session <id>`           | チャットセッションと関連付け                     |
| `--plans-dir <path>`            | 計画ディレクトリパスの上書き                     |
| `--no-duplicate-check`          | 既存のアクティブな計画に対する重複検出をスキップ |

#### plan list

```terminal
>tendril plan list [options]
```

オプションのフィルターを指定して計画を一覧表示します。

| オプション                 | 効果                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `--status` / `--state <s>` | 状態でフィルター（例: `Draft`、`Executing`、`Failed`）         |
| `-p, --project <name>`     | プロジェクト名でフィルター（設定済みプロジェクトに対して検証） |
| `--level <level>`          | レベルでフィルター（例: `Bug`、`Feature`、`Epic`）             |
| `--has-pr`                 | 関連 PR がある計画のみ                                         |
| `--has-worktree`           | ワークツリーがある計画のみ                                     |
| `-q, --search <query>`     | タイトルまたは ID のテキスト検索部分一致でフィルター           |
| `--limit <n>`              | 最大件数                                                       |
| `--format <fmt>`           | 出力形式: `table`（デフォルト）、`ids`、`folders`、`json`      |
| `--plans-dir <path>`       | 計画ディレクトリパスの上書き                                   |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` は計画（`plan.yaml` ファイル）を表示し、ジョブは表示しません。ジョブの履歴や実行ステータスについては、代わりに `job list` を使用してください（[その他のコマンド](05_Other.md#job-list) を参照）。

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

完全な YAML を出力するか、`[field]` が指定された場合は単一のフィールド値を出力します。

**スカラーフィールド:** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**リストフィールド:** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`（各項目を独立した行に出力）

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

単一のフィールドを更新し、`updated` タイムスタンプを自動的に更新します。

サポートされているフィールド: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`。

いずれかの検証が `Fail` 状態にある場合、`state` を `Completed` に設定することは拒否されます。検証ゲートが作業を拒絶しているにもかかわらず完了と判定されると、重複検出から成果物の不足が隠蔽されてしまうためです。検証を再実行するか、明示的な理由を付けて `Skipped` に設定してください。`--allow-failed-verifications` を渡すと強制的に遷移を記録し、`partialDelivery: true` を設定します。

| オプション                     | 効果                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| `--allow-failed-verifications` | 失敗した検証があっても `Completed` への移行を許可          |
| `--reason <text>`              | 編集の理由を記録（リスニング中のチャットセッションに通知） |
| `--chat-session <id>`          | 発生元チャットセッション（自身への通知から除外）           |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

`--file` または `--stdin` から `plan.yaml` の内容全体を置き換えます（必須 — `--stdin` は暗黙的ではありません）。

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

計画の変更されたファイル内にワイヤーフレームコードの漏洩がないかをチェックします。クリーンであれば終了コード 0、ワイヤーフレームのマーカーが見つかった場合は診断レポートとともに終了コード 1 で終了します。

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

計画に必要なすべてのフィールドが存在し、内部的に一貫しているかをチェックします。構造エラーがある場合は終了コード `1` で終了します。

## Repos

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

計画に関連付けられたリポジトリのリストを管理します。既存のリポジトリを追加する操作は冪等な no-op です。

## Links

```terminal
>tendril plan add-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan remove-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan add-commit <plan-id> <sha> [--reason <text>] [--chat-session <id>]
>tendril plan add-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan add-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
```

PR URL、コミット SHA、関連計画、およびブロッキング依存関係を管理します。`add-depends-on` を使用すると、`ExecutePlan` は実行前にその依存関係が `Completed` 状態に達し、その PR がマージされるのを待機します。すべての名前は大文字・小文字を区別せずに照合されます。

## Verifications

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

計画の検証を管理します。有効なステータス: `Pending`, `Pass`, `Fail`, `Skipped`。`add` のデフォルトステータスは `Pending` です。

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

計画に関連付けられたすべての git ワークツリーを削除します。デフォルトでは、終端状態（`Completed`、`Failed`、`Skipped`、`Icebox`）の計画に対してのみ実行されます。終端状態以外の計画のワークツリーを削除するには `--force` を使用します。

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

指定された計画の git ワークツリーを `<plan-folder>/Worktrees/<repo-name>` 配下に作成し、`origin/<base>`（デフォルト: 自動検出されたデフォルトブランチ）から分岐させます。ブランチ名は `tendril/<plan-folder-name>` となります。

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

`Worktrees/<repo-name>` から単一のワークツリーを削除します。最初に `git worktree remove --force` を試行し、失敗した場合は強制削除にフォールバックします。また、関連付けられたブランチ（デフォルトでは `tendril/<plan-folder>`）も削除します。

## Revisions

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

番号付きリビジョンファイル（例: `002.md`）を stdin または `--file` から `Revisions/` に書き込みます。バリデーションをバイパスする `--no-question-check`、および監査記録用の `--reason` / `--chat-session` に対応しています。

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

リビジョンの内容を stdout に出力します — デフォルトでは最新のリビジョン、`--number` が指定された場合は特定の番号のリビジョンを出力します。

## Questions

リビジョンには、フェンスブロック `questions` 内でユーザー向けの質問を含めることができます：

````markdown
```questions
questions:                    # 1〜4 項目
  - id:          string       # 必須、安定しており、リビジョン全体で一意
    title:       string       # 必須、質問文
    header:      string       # オプション、12文字以下のチップラベル
    description: markdown     # オプション、質問の下に表示されるコンテキスト
    multiple:    bool         # オプション、デフォルト false。true = 複数選択
    options:                  # 2〜4 項目。完全な自由記述形式の場合は省略
      - title:       string   # 必須、1〜5 単語
        description: markdown # オプション
        value:       slug     # 必須、^[a-z0-9][a-z0-9-]*$、`answer` から参照される
        recommended: bool     # オプション、質問ごとに最大1つ
    answer:      value | [values] | string   # 回答時に記入される
```
````

`write-revision` はすべての question ブロックをこのスキーマに対して検証し、不正な形式のブロックがある場合はリビジョンを拒否します。`--no-question-check` は自動テストでのみ使用してください。

## Recommendations

```terminal
>tendril plan rec list <plan-id> [--state <state>]
>tendril plan rec all [--project <project>] [--state <state>]
>tendril plan rec rebuild
>tendril plan rec add <plan-id> <title> [-d <description>] [--impact <level>]
>tendril plan rec set <plan-id> <title> <field> <value>
>tendril plan rec accept <plan-id> <title> [--notes <text>]
>tendril plan rec decline <plan-id> <title> [--reason <text>] [--edit-reason <text>]
>tendril plan rec remove <plan-id> <title>
```

計画の YAML に保存されているレコメンデーションを管理します：

- **list** — 計画のレコメンデーションを一覧表示。ステータスでフィルター: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — すべての計画にわたるレコメンデーションを一覧表示
- **rebuild** — ディスクから非正規化されたレコメンデーションプロジェクションを再構築
- **add** — 影響レベル: `Small`, `Medium`, `High`
- **set** — サポートされているフィールド: `title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — 状態を `Accepted`、または `--notes` が指定されている場合は `AcceptedWithNotes` に設定
- **decline** — 状態を `Declined` に設定。`--reason` は拒否理由を `plan.yaml` に記録し、`--edit-reason` はチャットセッションへの通知理由を指定
- **remove** — レコメンデーションを完全に削除

## Environment

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

計画のポート割り当てと環境ファイルを検査および書き込みます：

- **materialize** — 競合しないサービスポートを割り当て、計画のワークツリーに環境ファイルを書き込みます。既存のファイルを上書きするには `--force` を使用します。
- **get** — ワークツリーに割り当てられたポートと解決された環境変数を出力します。

## Doctor

```terminal
>tendril plan doctor [options]
```

計画ディレクトリ内のすべてのフォルダーをスキャンし、健全性の問題をレポートします。

| オプション      | 効果                                                                     |
| --------------- | ------------------------------------------------------------------------ |
| `--fix`         | 計画スキーマを最新バージョンに自動移行                                   |
| `--prs`         | `gh` 経由で GitHub に対して記録されたすべてのプルリクエストを検証        |
| `--prune-husks` | リビジョンも作業成果物も保持していない空の計画フォルダーを削除           |
| `--dry-run`     | `--prune-husks` と併用して、削除を実行せずに削除対象となる内容をレポート |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### 部分的納品のバックフィル

レポートには、検証が `Fail` 状態であり、`partialDelivery` フラグがないまま `Completed` とマークされている計画が一覧表示されます。これらは完了ガード導入前の古いデータです。部分的納品として承認するには：

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
