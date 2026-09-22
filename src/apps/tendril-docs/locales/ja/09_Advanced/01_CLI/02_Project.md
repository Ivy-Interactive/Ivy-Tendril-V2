---
title: project
description: config.yaml に保存されているプロジェクトを管理します。プロジェクトは、リポジトリ、検証、ビルド依存関係、レビューアクション、MCP サーバー、およびカスタムスキルをグループ化します。
icon: FolderGit
searchHints:
  - project
  - repo
  - verification
  - build
  - dependency
  - review
  - action
  - mcp
  - skills
  - sync
  - hooks
---

# project

`config.yaml` に保存されているプロジェクトを管理します。プロジェクトは、[Git](https://git-scm.com) リポジトリ、[検証](03_Verification.md)、ビルド依存関係、レビューアクション、[Model Context Protocol (MCP)](https://modelcontextprotocol.io) サーバー、およびカスタム [エージェントスキル](../../06_CodingAgents/00_Skills.md) をグループ化します。UI でのより広範なワークフローについては、[プロジェクト設定](../../03_Configuration/02_Projects.md) を参照してください。

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — 設定されているすべてのプロジェクトを一覧表示し、リポジトリ数と検証数を表示します
- **get** — リポジトリ、検証、レビューアクション、ビルド依存関係、MCP サーバー、カスタムスキルを含む完全な設定詳細を [YAML](https://yaml.org) 形式で表示します
- **add** — `config.yaml` に新しいプロジェクトエントリを作成します
- **rename** — 既存のプロジェクトの名前を変更し、すべての内部参照を更新します
- **remove** — `config.yaml` からプロジェクト設定を削除します
- **set** — スカラーのプロジェクトフィールドを更新します。サポートされているフィールド: `color`（16 進数カラー文字列）、`context`（エージェント向けのマークダウンプロンプト指示）、`stackHash`

## Repositories & Sync

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — ローカルリポジトリのチェックアウトパスをプロジェクトに関連付けます
- **remove-repo** — リポジトリパスとプロジェクトの関連付けを解除します
- **sync** — [Git](https://git-scm.com) を使用してリモートブランチをプルし、すべてのプロジェクトリポジトリをファストフォワードします。分岐が発生しているリポジトリには診断と修正手順がレポートされます。

## Verifications

プロジェクトは、[計画](01_Plan.md) を完了する前にどの [検証チェック](03_Verification.md) に合格する必要があるかを定義します：

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — グローバル検証チェックをこのプロジェクトにリンクします。デフォルトで必須（required）です。参考扱いにするには `--optional` を、実行順序を指定するには `--after` を渡します。
- **remove-verification** — プロジェクトから検証ゲートを削除します。
- **move-verification** — 他の検証に対する実行順序の位置を調整します（`--before`、`--after`、または 0 から始まる `--position`）。

## Build Dependencies

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

計画を実行する前に検証される外部バイナリおよびツールの前提条件（例: `cargo`, `dotnet`, `node`, [gh](https://cli.github.com)）を設定します。

## Review Actions

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

レビューアクションは、対話型コードレビュー中に実行されるシェルコマンドです：

| オプション         | 効果                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `--command <cmd>`  | 対話型ターミナル PTY 内で実行されるシェルコマンドライン                    |
| `--condition <ex>` | アクションを実行する前に評価されるオプションの式                           |
| `--paths <prefix>` | 変更時にこのアクションをトリガーするリポジトリ相対パスフィルター（複数可） |
| `--before <name>`  | 既存のアクションの前に挿入                                                 |
| `--after <name>`   | 既存のアクションの後に挿入                                                 |

`tendril project review-actions` は、計画のワークツリーから取得された変更ファイルに対してレビューアクションを評価しランク付けします。

## MCP Servers & Custom Skills

プロジェクトは、プロジェクトスコープの [MCP](https://modelcontextprotocol.io) サーバーおよびカスタムエージェントスキルを登録できます：

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

既存のリポジトリから MCP サーバーまたはスキルを直接インポートするには：

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Promptware Hooks

フックは、[プロンプトウェア](../../02_Concepts/02_Promptwares.md) の実行前または実行後にカスタムシェルアクションを実行します：

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| オプション             | 効果                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `--when <timing>`      | タイミングトリガー: `before`（デフォルト）または `after`                                       |
| `--promptwares <list>` | トリガー対象とするカンマ区切りのプロンプトウェア（例: `ExecutePlan,CreatePr`）。省略時はすべて |
| `--action <cmd>`       | 実行するシェルコマンド                                                                         |
| `--condition <expr>`   | フックが実行されるために true と評価される必要がある式                                         |

## Ports & Environment Files

名前付きサービスポートと、計画ワークツリーに実体化される `.env` テンプレートファイルを管理します：

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
