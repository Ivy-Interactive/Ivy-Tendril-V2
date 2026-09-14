<p align="right">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <strong>日本語</strong> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a>
</p>

<h1>
  <a href="https://tendril.ivy.app"><img src="../../src/logo.png" alt="Tendril Logo" width="64" valign="middle" /></a> Ivy Tendril
</h1>

<p>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/stargazers"><img src="https://img.shields.io/github/stars/Ivy-Interactive/Ivy-Tendril?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest"><img src="https://img.shields.io/github/v/release/Ivy-Interactive/Ivy-Tendril?style=flat&label=release" alt="Latest Release" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/actions/workflows/repo-health.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivy-Interactive/Ivy-Tendril/repo-health.yml?branch=development&style=flat&label=CI" alt="CI Status" /></a>
  <a href="https://tendril.ivy.app"><img src="https://img.shields.io/badge/docs-tendril.ivy.app-blue?style=flat" alt="Documentation" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="対応プラットフォーム: macOS, Windows, Linux" />
</p>

<h2>10倍の生産性を誇る開発者のためのエージェンティック・ソフトウェア・ファクトリー</h2>

<p>
現在、AIエージェントはコードの99%を書くことができます。これにより、開発者であることの意味が大きく変わりました。私たちの役割は<strong>何が良いコードであるかを見極めること</strong>へとシフトしています。そのためには、まったく新しい開発者ツールが必要です。Tendrilはそのツールであり、エージェンティック時代におけるIDEの代替となります。
</p>

<p>
<a href="https://youtu.be/_KVG1NnAj-8">
  <img src="../yt-thumbnail-in-two-minutes-2.png" alt="2分でわかる Ivy Tendril: YouTube で視聴" width="720">
</a>
</p>

<p>https://youtu.be/_KVG1NnAj-8</p>

## 機能

<table>
<tr>
<td width="50%" valign="middle">

### 並行ワークツリー (Parallel Worktrees)

分離されたgitワークツリー内でエージェントを実行します。変更をレビュー、承認、マージするまで、メインブランチを常にクリーンに保ちます。

[ドキュメント &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/worktrees.gif" alt="並行ワークツリー" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### トンネリング (Tunneling) (リモート & モバイルコーディング)

Cloudflare Quick Tunnelsを使用してサーバーを安全に公開し、どこからでもエージェントの実行を監視および指示できます。

[ドキュメント &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/tunneling.gif" alt="トンネリング" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 音声およびリッチ入力 (Voice & Rich Input)

組み込みのWhisper音声入力を使用してプロンプトを口述し、ドラッグ＆ドロップでテキストファイル、ログ、ドキュメントを簡単に追加できます。

[ドキュメント &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/voice.gif" alt="音声およびリッチ入力" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 計画アノテーション (Plan Annotations)

ドラフト内でインライン注釈を付け、改訂された目標でエージェントの計画を自動更新します。

[ドキュメント &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/annotation.gif" alt="計画アノテーション" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 高度なコードレビュー (Code Reviews)

エージェントのコード変更をレビューし、差分を検査し、自動検証ゲートによってコードを承認します。

[ドキュメント &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/review.gif" alt="高度なコードレビュー" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### GitHub 連携と自動受信トレイ (GitHub Integration & Automated Inbox)

Webhookを介してGitHub Issuesやjam.devのバグレポートを取り込み、Markdown計画を自動的にアクティブなジョブに変換します。

[ドキュメント &rarr;](https://tendril.ivy.app/docs/integrations/jamdev)

</td>
<td width="50%">
  <img src="../../src/github.gif" alt="GitHub 連携と自動受信トレイ" width="100%" />
</td>
</tr>
</table>

---

## サポートされているエージェント

**あらゆるCLIエージェント**に対応: ターミナルで動作するものであれば、Tendrilでも動作します。

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Claude Code logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Codex logo" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="GitHub Copilot logo" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://github.com/google-gemini/gemini-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Gemini logo" width="16" valign="middle" /> Gemini</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="OpenCode logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <kbd>+ 任意のCLIエージェント</kbd>
</p>

## エージェントスキル (Agent Skills)

公式のTendrilエンジニアリングおよびデバッグスキルを使用して、お気に入りのAIコーディングエージェントを拡張できます。

### クイックスタート

ユニバーサルスキルインストーラーを使用して、サポートされている任意のエージェントにTendrilスキルをインストールします:

```bash
npx skills add ivy-interactive/ivy-tendril
```

または特定のスキルを個別インストール:

```bash
npx skills add ivy-interactive/ivy-tendril --skill tendril-debug-plan
```

### サポートされているツールと環境

<details>
<summary><strong>Visual Studio Code (GitHub Copilot および拡張機能)</strong></summary>

VS CodeのGitHub Copilot用スキルをインストール:

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot
```

グローバルインストール (すべてのワークスペースで有効):

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot -g
```

または、ワークスペースのルートにある `.agents/skills/` や `.github/skills/` (プロジェクト単位) または `~/.copilot/skills/` (グローバル) に直接コピーします。

インストールすると、GitHub Copilot Chatの `/skills` メニューにスキルが表示され、スラッシュコマンド (例: `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`) として直接呼び出すことができます。

サードパーティ製VS Codeエージェント拡張機能:
- Cline: `npx skills add ivy-interactive/ivy-tendril --agent cline`
- Continue: `npx skills add ivy-interactive/ivy-tendril --agent continue`
- Roo Code: `npx skills add ivy-interactive/ivy-tendril --agent roo`

完全なエディタ統合を行うには、公式の [Ivy Tendril VS Code 拡張機能](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) をインストールして、計画ダッシュボード、ワークツリーナビゲーション、実行のリアルタイム監視を利用してください。

詳細な設定オプションについては、[VS Code 設定ガイド](../vscode-setup.md) を参照してください。
</details>

<details>
<summary><strong>Claude Code</strong></summary>

Claude Codeプラグインマーケットプレイスからインストール:

```
/plugin marketplace add ivy-interactive/ivy-tendril
/plugin install tendril-skills@ivy-tendril
```

ローカル開発環境:

```bash
claude --plugin-dir /path/to/ivy-tendril
```

詳細な設定オプションについては、[Claude Code 設定ガイド](../claude-setup.md) を参照してください。
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

Git URLからプラグインをインストール:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril.git
```

ローカルインストール:

```bash
agy plugin install ./
```

詳細な設定オプションについては、[Antigravity 設定ガイド](../antigravity-setup.md) を参照してください。
</details>

<details>
<summary><strong>Cursor</strong></summary>

Cursor向けにインストール:

```bash
npx skills add ivy-interactive/ivy-tendril --agent cursor
```

または `.cursor/skills/` (プロジェクト単位) や `~/.cursor/skills/` (グローバル) にスキルをコピーします。

詳細な設定オプションについては、[Cursor 設定ガイド](../cursor-setup.md) を参照してください。
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Codexプラグインマーケットプレイスからインストール:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril
codex plugin add tendril-skills@tendril-skills
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Gemini CLIを使用してインストール:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril.git --path skills
```
</details>

---

## インストール

[GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) からスタンドアロンのデスクトップインストーラー（`.pkg`, `.AppImage`, `.exe`）を直接ダウンロードするか、以下のクイックインストールコマンドを実行してください:

**macOS / Linux:**
```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows:**
```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

### 実行

Tendrilはデスクトップアプリケーションですが、CLIから起動および制御することもできます:

デスクトップアプリケーションの起動:
```bash
tendril
```

ヘッドレスモードで起動 (デスクトップUIなしのWebサーバー):
```bash
tendril --web
```

---

## 🏛 ディレクトリ構成

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   └── tendril-app/            # Tauriデスクトップアプリ + Reactフロントエンド
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # コアドメインモデル, SQLiteデータベース, ワークツリーエンジン
│   │   ├── tendril-server/         # Axum REST & WebSocket HTTPサーバーデーモン
│   │   └── tendril-cli/            # コマンドラインインターフェース ("tendril")
│   └── promptwares/                # Promptwareエージェント定義 & ファームウェア
├── Cargo.toml                      # 統合Cargoワークスペース
├── pnpm-workspace.yaml             # 統合pnpmワークスペース
└── package.json                    # ワークスペースルートスクリプト
```

---

## 🚀 はじめに

### 前提条件
- [Rust](https://rustup.rs/) (edition 2021)
- [Node.js](https://nodejs.org/) (v22+) & [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### クイックスタート

1. **依存関係のインストール**:
   ```bash
   pnpm install
   ```

2. **コンポーネント & UIライブラリのビルド**:
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **Storybookの起動**:
   ```bash
   pnpm dev:storybook
   ```

4. **デスクトップアプリのビルド & 実行**:
   ```bash
   pnpm dev:app
   ```

5. **バックエンドクレートのビルド**:
   ```bash
   cargo build --workspace
   ```

6. **テストの実行**:
   ```bash
   # Web & コンポーネントテスト
   pnpm test

   # Rustテスト
   cargo test --workspace
   ```

---

## コミュニティ & サポート

- **Discord:** **[Discord](https://discord.gg/FHgxkDga3y)** コミュニティに参加してください。
- **フィードバック & アイデア:** バグの発見や新機能の提案は、[Issue を作成](https://github.com/Ivy-Interactive/Ivy-Tendril/issues) してください。
- **サポート:** 開発の進捗をフォローするために、ぜひこのリポジトリに [Star](https://github.com/Ivy-Interactive/Ivy-Tendril) をお願いします。

---

## ライセンス

Tendril は [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) の下でソースが公開されています。エージェントのスキルおよびプラグイン (`skills/`, `.claude-plugin/`, `.codex-plugin/`, `.agents/`) もルートリポジトリの条項 ([Functional Source License (FSL-1.1-ALv2)](../../LICENSE)) に基づいてライセンスされています。
