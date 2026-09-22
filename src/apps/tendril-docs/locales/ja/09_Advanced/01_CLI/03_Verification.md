---
title: verification
description: config.yaml に保存されているグローバル検証定義を管理します。これらはプロジェクトや計画から参照できます。
icon: ClipboardCheck
searchHints:
  - verification
  - verify
  - check
  - prompt
  - definition
  - gates
---

# verification

`config.yaml` に保存されているグローバル検証定義を管理します。検証ゲートは、[計画](01_Plan.md) が `Completed` に移行する前にコーディングエージェントが満たさなければならない自動化された品質、ビルド、およびテストチェックを定義します。これらは [`tendril project add-verification`](02_Project.md#verifications) 経由でプロジェクトに割り当てられます。

## Commands

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — 登録されているすべてのグローバル検証を表示します。`--json` を渡すと構造化 JSON として出力します。
- **get** — 検証の名前と完全な評価プロンプトテキストを stdout に出力します。
- **add** — オプションのプロンプト説明を付けて新しい検証チェックを登録します。
- **set** — 検証定義のプロンプトを更新するか、名前を変更します。検証の名前を変更すると、すべてのプロジェクト参照、計画 YAML レコード、およびデータベース行が自動的に更新されます。
- **remove** — 検証定義を削除します。アクティブなプロジェクトがいずれかのチェックを参照している場合、`--force`（または `-f`）が指定されない限り Tendril は削除を拒絶します。`--force` が指定された場合はすべてのプロジェクトにわたる参照をクリーンアップします。

## Examples

```terminal
># プロンプト指示を付けて新しい検証ゲートを追加
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># プロンプトの詳細を確認
>tendril verification get CargoTest

># 評価プロンプトを更新
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># プロジェクトや計画をまたいで検証定義の名前を変更
>tendril verification set CargoTest --new-name RustWorkspaceTests

># すべての定義を JSON 形式で一覧表示
>tendril verification list --json

># プロジェクトの参照をクリーンアップしつつ検証を削除
>tendril verification remove RustWorkspaceTests --force
```

## Related

- [プロジェクトの検証](02_Project.md#verifications) — プロジェクトに必要なチェックを設定
- [計画の検証](01_Plan.md#verifications) — 計画上の検証ゲートのステータスを検査または上書き
- [設定リファレンス](../../03_Configuration/01_Setup.md) — `config.yaml` のグローバル設定を管理
