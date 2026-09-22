# Visual Studio Code 向け Tendril Skills セットアップガイド

このガイドでは、Visual Studio Code で GitHub Copilot やその他の AI エージェント拡張機能を使用して Tendril Agent Skills をインストール、設定、および使用する方法について説明します。

## 1. クイックインストール（Skills CLI）

VS Code の GitHub Copilot 向けに Tendril スキルをインストールする最も簡単な方法は、オープンな agent skills CLI を使用することです：

```bash
# プロジェクトレベルのインストール（.agents/skills/ または .github/skills/ にインストール）
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# グローバルインストール（すべての VS Code ワークスペースで利用可能）
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

パッケージ全体ではなく、個別のスキルをインストールする場合：

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. 手動インストールパス

CLI を使わずに手動でスキルフォルダを配置したい場合：

- **ワークスペースリポジトリ（チーム推奨）**:
  ワークスペースのルートにある `.agents/skills/<skill-name>` または `.github/skills/<skill-name>` にスキルをコピーします。
- **ユーザープロファイル（全プロジェクトでグローバル）**:
  `~/.copilot/skills/<skill-name>`（macOS/Linux）または `%USERPROFILE%\.copilot\skills\<skill-name>`（Windows）にスキルをコピーします。

各スキルフォルダに `SKILL.md` 仕様書と、付随する `references/` や `scripts/` ディレクトリが含まれていることを確認してください。

## 3. GitHub Copilot Chat でのスキルの使用

インストール後、GitHub Copilot は自動的にスキルを検出します：

1. VS Code で Copilot Chat を開きます（`Ctrl+Alt+I` / `Cmd+Ctrl+I`）。
2. `/skills` と入力して、読み込まれたスキルとその説明を確認します。
3. 任意の Tendril スキルをコマンドとして直接呼び出します：
   - `/tendril-debug-plan <plan-id>`: 計画の実行ログ、タイムライン、および検証結果を検査します。
   - `/tendril-debug-job <job-id>`: ジョブ成果物、エージェントログ、未加工イベントを分析します。
   - `/tendril-review`: 変更されたファイルに対して、変更後の包括的なコードおよびテストレビューを実行します。
   - `/tendrillable <url>`: 自律エージェントでの実行適性について GitHub issue を評価します。

## 4. その他の VS Code AI 拡張機能との統合

Tendril スキルはオープンエージェントスキル規格に準拠しており、サードパーティの VS Code 拡張機能とシームレスに連携します：

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
スキルは `.cline/skills/` またはグローバル Cline 設定ディレクトリに書き込まれます。

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
スキルは `.continue/skills/` ディレクトリにインストールされ、プロンプトコンテキスト内で参照できます。

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
カスタムシステムモードやタスク実行のために `.roo/skills/` にインストールされます。

## 5. 公式 Ivy Tendril VS Code 拡張機能との併用

統合された開発ワークフローを実現するために、公式の [Ivy Tendril VS Code 拡張機能](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) をインストールしてください：

- **プランダッシュボード**: サイドバーから直接、計画の参照、レビュー、トリガーが可能です。
- **ワークツリーナビゲーター**: ワンクリックで隔離された実行ワークツリーにジャンプできます。
- **サーバー制御**: バックグラウンドの Tendril サーバープロセスの開始、停止、検査を行えます。

Tendril スキルと VS Code 拡張機能を組み合わせることで、自律コーディングエージェントオーケストレーションのための完全なコントロールセンターが手に入ります。

## ライセンス

Tendril のスキルおよびプラグインは、リポジトリルートの [Functional Source License (FSL-1.1-ALv2)](../LICENSE) の下でライセンスされています。
