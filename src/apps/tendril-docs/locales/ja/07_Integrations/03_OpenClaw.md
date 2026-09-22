---
title: OpenClaw
description: Inbox フォルダーに Markdown ファイルをドロップすることで、OpenClaw や任意のファイルベースのツールを Tendril と連携します。
icon: Terminal
searchHints:
  - openclaw
  - inbox
  - folder
  - file watcher
  - drop folder
  - 受信トレイ
  - ファイル監視
---

# OpenClaw

## 概要

Tendril は **Inbox フォルダー** を監視して新しい Markdown ファイルを検出し、自動的に[計画](../02_Concepts/01_Plans.md)に変換します。これにより、OpenClaw などの外部ツールやディスクにファイルを書き出すカスタムスクリプト向けの、シンプルなファイルベースの統合ポイントが提供されます。

## Inbox フォルダーの場所

```
$TENDRIL_HOME/Inbox/
```

Tendril ホームディレクトリと設定の詳細については、[セットアップと設定](../03_Configuration/01_Setup.md)を参照してください。Tendril のファイルシステムウォッチャーはこのディレクトリの新しい `.md` ファイルを監視します。

## ファイル形式

任意の YAML フロントマターを含む Markdown ファイル（`.md`）をドロップします:

```markdown
---
project: ProjectName
sourcePath: optional/path/to/code
---

ここに計画の内容を記述します。このテキストが計画の説明になり、
[CreatePlan プロンプトウェア](../02_Concepts/02_Promptwares.md) に渡されます。
```

| フィールド   | 必須   | 説明                                      |
| ------------ | ------ | ----------------------------------------- |
| `project`    | いいえ | 対象プロジェクト名（デフォルトは `Auto`） |
| `sourcePath` | いいえ | 関連するソースコードのパスのヒント        |

フロントマターの後のコンテンツが計画の説明になります。

> [!NOTE]
> フロントマターを完全に省略した場合、ファイルの内容全体がデフォルト設定の計画の説明として使用されます。

## ファイルのライフサイクル

1. **ドロップ (Drop)** — `.md` ファイルを Inbox フォルダーに配置します
2. **処理中 (Processing)** — 処理中はファイル名が `.md.processing` に変更されます
3. **完了 (Completion)** — 計画が正常に作成されると、ファイルは削除されます

## リカバリ

処理中に Tendril が再起動した場合、`.md.processing` ファイルは起動時に自動的に `.md` に復元され、再処理されます。

## OpenClaw でのセットアップ

OpenClaw がその出力を Markdown ファイルとして Tendril の Inbox フォルダーに書き出すように設定します。各ファイルが個別の計画になります:

1. 出力ディレクトリを `$TENDRIL_HOME/Inbox/` に設定します
2. プロジェクトを指定するために YAML フロントマター付きの Markdown 形式を使用します
3. Tendril は新しいファイルを自動的に検出します — ポーリングや API 呼び出しは不要です
