---
title: Ivy Tendril へようこそ
description: >-
  Tendril はオープンソースかつローカルファーストのデスクトップアプリケーションであり、Claude Code、Codex、Copilot、Gemini、OpenCode、Antigravity、Cursor、Apple Foundation Models などのコーディングエージェントを、アイデアからマージされたプルリクエストまでの構造化されたライフサイクルを通じてオーケストレーションする、AI 搭載ソフトウェア開発のためのオペレーティングシステムとして機能します。
icon: Rocket
searchHints:
  - 概要
  - tendril とは
  - エージェントオーケストレーション
  - アーキテクチャ
  - tauri
  - デーモン
---

# Ivy Tendril へようこそ

[![2分でわかる Ivy Tendril: YouTube で視聴](../assets/yt-thumbnail-in-two-minutes-2.png)](https://youtu.be/_KVG1NnAj-8)

## コンセプト

Tendril では、作業は [**計画 (plans)**](../02_Concepts/01_Plans.md) として整理されます。これは構造化され、レビュー可能な作業単位です。未検証のコードを出力する不透明なブラックボックスとは異なり、Tendril は [**プロンプトウェア (promptwares)**](../02_Concepts/02_Promptwares.md)（各段階に特化した独立した単一目的のワークフローエージェント）を使用して、定義された [ライフサイクル](../02_Concepts/03_Lifecycle.md) に沿って計画を進めます。計画のドラフト作成、並行ワークツリーでの変更の実装、検証ゲートの実行、プルリクエストの作成のいずれにおいても、完全な可視性が保たれます。Tendril はエディタ内の行を自動補完するだけではなく、自律的な開発ワークフロー全体をオーケストレーションします。

## 主な機能

- **並行ワークツリー** — すべてのエージェントは分離された [Git ワークツリー](https://git-scm.com/docs/git-worktree) 内で動作するため、ブランチの汚染や作業ツリーの競合を起こすことなく、複数の計画を同時に実行できます。
- **リモートおよびモバイル作業向けトンネリング** — [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) を通じてローカルデーモンを安全に公開し、スマートフォンやリモートブラウザから進行状況を確認し、実行中のエージェントを操作できます。
- **音声およびリッチ入力** — 組み込みの [OpenAI Whisper](https://github.com/openai/whisper) 文字起こしを使用して要件を口述したり、ターミナルログ、マークダウン仕様書、デザインファイルをコンテキストとしてドラッグ＆ドロップしたりできます。
- **計画アノテーション** — ドラフト計画内にインラインで注釈を記入できます。Tendril はそのメモを [UpdatePlan](../02_Concepts/02_Promptwares.md) に直接送り、仕様を改訂します。
- **検証ゲート付きコードレビュー** — git 差分を検査し、自動テスト結果（`Cargo`、`pnpm`、lint、フォーマット）を確認して、検証済みの変更のみを承認します。
- **GitHub および受信トレイの取り込み** — Webhook を介して、受信した [GitHub](https://github.com) の issue や [Jam.dev](https://jam.dev) のバグレポートを自動的に計画に変換します。

## アーキテクチャ

Tendril は、ローカルマシン上で動作する 3 つのコアコンポーネントで構成されています：

- [Tauri 2](https://tauri.app) で構築された **デスクトップアプリ** — [React](https://react.dev) フロントエンドを収容する高性能なネイティブデスクトップシェル。
- [Rust](https://www.rust-lang.org) で記述された **サーバーデーモン**（`tendril run` / `tendril serve`）— REST および WebSocket API を公開します。デスクトップアプリはバックグラウンドで自動的にデーモンを起動し監視します。
- 同じデーモンに接続し同じデータストアを共有する **CLI**（`tendril`）。デスクトップアプリから制御可能なすべての操作をコマンドライン経由で実行できます。

状態は完全にローカルに保持されます：

- `$TENDRIL_HOME/tendril.db` にあるローカル [SQLite](https://www.sqlite.org) データベースが、ジョブ、コスト、テレメトリを記録します。
- `$TENDRIL_HOME/Plans/` にあるプレーンなファイルストレージが、計画ファイル、改訂版、注釈、ログ、検証レポートを透過的な YAML および Markdown ドキュメントとして保存します。

> [!NOTE]
> `$TENDRIL_HOME` のデフォルトは `~/.tendril` です。カスタムパスの設定については [インストール](02_Installation.md) を参照してください。

ソースコードがローカルマシンから外部に送信されることはありません。唯一のアウトバウンドネットワークトラフィックは、設定されたコーディングエージェントの直接 API リクエスト（Anthropic、OpenAI、Google など）と、明示的に開始したオプションの Cloudflare トンネルのみです。

サポートされているコーディングエージェント：

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models（オンデバイス `fm` を経由した `apple`）

## なぜ Tendril なのか？

[Ivy Interactive](https://ivy.app) では、自律コーディングのための複数のマルチエージェントアーキテクチャをテストしました。個々の CLI エージェントは強力でしたが、何十ものターミナルタブを管理し、追跡されていない差分をレビューする作業はすぐに破綻しました。

Tendril はエージェンティックエンジニアリングに構造をもたらします。[プロンプトウェア](../02_Concepts/02_Promptwares.md) アーキテクチャを通じて、ワークフローエージェントは実行を重ねるごとにプロジェクト固有の記憶を蓄積し、コードベースのイディオムを学習して同じ失敗の繰り返しを防ぎます。ワークフロー全体を持続的な [計画](../02_Concepts/01_Plans.md) を中心に構成することで、自律エージェントが実装の重労働をこなす間も、人間の開発者がレビューのコントロールを維持できます。

> [!TIP]
> 皆様からのフィードバックをお待ちしております。[GitHub リポジトリ](https://github.com/Ivy-Interactive/Ivy-Tendril-V2) で問題の報告や機能提案を行っていただけます。サポートや議論については、[Discord](https://discord.gg/FHgxkDga3y) のコミュニティにご参加ください。

## 次のステップ

- [インストール](02_Installation.md) — デスクトップアプリと CLI をビルドしてインストールします。
- [コンセプト](../02_Concepts/_Index.md) — 計画、プロンプトウェア、ジョブライフサイクルの詳細を学びます。
