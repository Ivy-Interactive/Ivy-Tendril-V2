# Cursor 向け Tendril Skills セットアップガイド

このガイドでは、Cursor で Tendril Agent Skills をインストールおよび設定する方法について説明します。

## 1. クイックインストール（Skills CLI）

Skills CLI を使用して、Cursor プロジェクトに Tendril スキルをインストールします：

```bash
# プロジェクトレベルのインストール（.cursor/skills/ にインストール）
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# グローバルインストール（すべての Cursor ワークスペースで利用可能）
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Cursor でのディレクトリ構成

Cursor は以下の場所でスキル定義を検索します：

- **プロジェクトレベル**: `.cursor/skills/<skill-name>/SKILL.md`
- **グローバル / ユーザーレベル**: `~/.cursor/skills/<skill-name>/SKILL.md`（macOS/Linux）または `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md`（Windows）

各フォルダには以下が含まれます：
- `SKILL.md`: YAML フロントマター付きの主要な指示内容
- 補足のリファレンスドキュメントおよびスクリプト

## 3. Cursor ルール（.cursorrules）との連携

プロジェクトの `.cursorrules` または `.cursor/rules/*.mdc` ファイルから Tendril スキルを参照できます：

```markdown
When debugging failed plans or reviewing changes:
- Reference src/skills/tendril-debug-plan for plan execution diagnosis.
- Run src/skills/tendril-review procedures before finalizing pull requests.
```

## 4. Cursor エージェントチャットでの使用方法

Cursor のエージェントチャットウィンドウ内：
- `@tendril-debug-plan` と入力するか、その指示に従って計画を調査するようエージェントに依頼します。
- アクティブな git diff に対して `/tendril-review` を実行するよう Cursor に依頼します。
- `/tendrillable` を実行して、課題がエージェントでの対応に適しているかをランク付けします。

## ライセンス

Tendril のスキルおよびプラグインは、リポジトリルートの [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) の下でライセンスされています。
