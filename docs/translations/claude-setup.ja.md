# Claude Code 向け Tendril Skills セットアップガイド

このガイドでは、Claude Code で Tendril Agent Skills をインストール、設定、およびテストする方法について説明します。

## 1. プラグインマーケットプレイスによるインストール

Tendril は `.claude-plugin/marketplace.json` および `.claude-plugin/plugin.json` に公式のプラグインマニフェストを提供しています。

Claude Code で、Ivy-Tendril-V2 リポジトリをマーケットプレイスソースとして追加します：

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

次に `tendril-skills` プラグインをインストールします：

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. ローカル開発とテスト

スキルをローカルで開発する場合や、プッシュ前に変更をテストする場合：

プラグインディレクトリをローカルリポジトリのチェックアウト先に指定して Claude Code を起動します：

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Claude Code は `.claude-plugin/plugin.json` を読み込み、`skills/` で定義されているすべてのスキルを自動的にマウントします。

## 3. .claude/skills との後方互換性

Ivy-Tendril-V2 内でのローカルリポジトリワークフローについて：
- `.claude/skills/<skill-name>` のシンボリックリンクは `../../skills/<skill-name>` を指しています。
- `.claude/skills/` を参照する既存のローカル Claude Code 設定は、手動での再設定を行うことなくシームレスに機能し続けます。

## 4. Claude Code でのスキルの呼び出し

インストール後、Claude Code セッションでスラッシュコマンドを直接使用できます：

- `/tendril-debug-plan <plan-id>`: 失敗した計画や低速な計画をデバッグします。
- `/tendril-debug-job <job-id>`: ジョブ成果物とエージェントの決定ログを検査します。
- `/tendril-review`: 現在の差分に対してコード品質とリグレッションチェックを実行します。
- `/tendrillable <url>`: 自律エージェントの評価基準に従ってバックログ課題を分類します。
- `/tendril-release`: バージョン更新、依存関係の更新、およびリリースワークフローを自動化します。

## ライセンス

Tendril のスキルおよびプラグインは、リポジトリルートの [Functional Source License (FSL-1.1-ALv2)](../LICENSE) の下でライセンスされています。
