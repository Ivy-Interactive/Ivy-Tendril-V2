---
title: config
description: config.yaml に保存されているトップレベルの Tendril 設定項目をコマンドラインから直接取得および設定します。
icon: Settings
searchHints:
  - config
  - 設定
  - settings
  - jobTimeout
  - codingAgent
  - planTemplate
  - gitTimeout
  - daemonRequestTimeout
  - llm
---

# config

`config.yaml` 内に [YAML](https://yaml.org) 形式で保存されているトップレベルの Tendril 設定項目を取得および設定します — デスクトップおよび Web インターフェースの「設定」で管理されるのと同じグローバル値です。環境およびディレクトリレイアウトの詳細については、[セットアップガイド](../../03_Configuration/01_Setup.md) を参照してください。

## Commands

```terminal
>tendril config get <key>
>tendril config set <key> <value>
```

- **`get`** — 装飾的な書式設定なしで生の値を標準出力に出力します。シェルスクリプトやファイル、他のツールへのパイプ処理に最適です。
- **`set`** — `config.yaml` 内の値を検証して更新します。キーは大文字・小文字を区別しません。

## Primitive Keys

Tendril は、型検証を伴ういくつかのプリミティブ設定キーをモデル化しています：

| キー                           | 型                                        | デフォルト         | 説明                                                                                                                     |
| ------------------------------ | ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `codingAgent`                  | 文字列                                    | `claude`           | デフォルトのコーディングエージェントの実行可能ファイルまたはエイリアス（例: `claude`, `aider`, `codestory`）。           |
| `jobTimeout`                   | 整数（分）                                | `120`              | 実行中の計画ジョブの最大実行タイムアウト。                                                                               |
| `staleOutputTimeout`           | 整数（分）                                | `10`               | 出力がないジョブがストール（停止）とフラグ付けされるまでの無通信時間。                                                   |
| `gitTimeout`                   | 整数（分）                                | `5`                | [Git](https://git-scm.com) 操作のコマンドタイムアウト。                                                                  |
| `daemonRequestTimeout`         | 整数（秒）                                | `30`               | ローカル Tendril デーモンへの HTTP リクエストのタイムアウト秒数（`0` または負の値で無効化）。                            |
| `maxConcurrentJobs`            | 整数                                      | `2`                | 許可される同時実行ジョブの最大数。                                                                                       |
| `planTemplate`                 | 文字列                                    | `""`               | 新しい計画を作成するときに先頭に追加される [Markdown](https://daringfireball.net/projects/markdown/) テンプレート。      |
| `planFolder`                   | 文字列（オプション）                      | `None`             | 計画マークダウンファイルが保存されるカスタムファイルシステムディレクトリ。`""` を渡すと解除されます。                    |
| `promptwareOverlay`            | 文字列（オプション）                      | `None`             | カスタムプロンプトウェアを含むオーバーレイディレクトリへのパス。`""` を渡すと解除されます。                              |
| `telemetry`                    | 真偽値（オプション）                      | `None`             | オプトインの匿名テレメトリ切り替え（`true` または `false`）。`""` を渡すとクリアされます。                               |
| `beta`                         | 真偽値                                    | `false`            | 実験的なプレビュー機能を有効化（`true` または `false`）。                                                                |
| `desktopNotifications`         | 真偽値                                    | `true`             | 計画ステータスとエージェント完了に関するシステムデスクトップ通知を有効化（`true` または `false`）。                      |
| `theme`                        | 文字列                                    | `default`          | UI カラープリセット ID（例: `default`, `dracula`）。                                                                     |
| `worktreeReaperInterval`       | 整数（分）                                | `60`               | 自動化された [Git](https://git-scm.com) ワークツリー刈り取りパスの頻度（`0` または負の値で無効化）。                     |
| `worktreeReaperGrace`          | 整数（分）                                | `1440`             | 非アクティブなワークツリーが刈り取り対象と見なされるまでのアイドル猶予期間（分単位）。                                   |
| `worktreeBranchDeleteMode`     | 文字列                                    | `PreserveUnpushed` | ワークツリー刈り取り時のブランチ削除安全性モード（`PreserveUnpushed` または `Force`）。                                  |
| `coAuthor`                     | 文字列（オプション）                      | `None`             | 自動コミットに追加される `Name <email>` 形式の [Git](https://git-scm.com) トレーラー属性 ID。`""` を渡すと解除されます。 |
| `enrichModels`                 | 真偽値                                    | `true`             | 自動バックグラウンドモデル検出およびエンリッチメントを有効化（`true` または `false`）。                                  |
| `modelEnrichmentIntervalHours` | 整数（時間）                              | `24`               | モデルメタデータのバックグラウンド更新間隔。                                                                             |
| `modelCacheWarnAgeDays`        | 整数（日数）                              | `7`                | 古いモデルキャッシュが警告を生成するまでのソフトな経過日数しきい値。                                                     |
| `modelCacheMaxAgeDays`         | 整数（日数）                              | `30`               | キャッシュされたモデルメタデータが期限切れになるハードな経過日数しきい値。                                               |
| `llm`                          | [JSON](https://www.json.org) オブジェクト | `None`             | 補助 LLM サービスのエンドポイント、API キー、およびモデル設定。既存のフィールドとマージされます。                        |

> [!NOTE]
> モデル化されていないスカラーキーも保存および取得できます。これらは `config.yaml` の追加属性テーブルに保存されます。

## Structured Keys

Tendril の設定には、`tendril config` 経由で設定または取得できない構造化リストやマップも含まれています：

- `projects` — 設定されたプロジェクト定義（[`tendril project`](02_Project.md) を使用して管理）。
- `verifications` — グローバル検証スイート定義（[`tendril verification`](03_Verification.md) を使用して管理）。
- `levels` — 計画の複雑さの階層と検証バインディング。
- `onboarding` — 初回実行ウィザードの完了状態。
- `codingAgents` — エージェントごとのバイナリパス、引数、環境変数、プロファイル。
- `promptwares` — プロンプトウェアごとの指示、プロファイル、ツールルール。
- `inbox` — 受信通知ルールと配信統合。

構造化キーに対して `tendril config get` または `tendril config set` を実行しようとすると、専用の CLI コマンドを使用するか `config.yaml` を直接編集するよう指示するエラーが出力されます。

## Examples

```terminal
># 設定値を読み取る
>tendril config get jobTimeout

># 数値またはテキスト設定を更新する
>tendril config set jobTimeout 60
>tendril config set codingAgent claude

># ブール値オプションを切り替える
>tendril config set desktopNotifications false
>tendril config set beta true

># 補助 LLM 設定をマージする
>tendril config set llm '{"model":"gpt-4o"}'

># 空の文字列を渡してオプション設定をクリアする
>tendril config set coAuthor ""
>tendril config set planFolder ""

># シェルコマンド置換を使用して複数行の計画テンプレートを設定する
>tendril config set planTemplate "$(cat template.md)"

># 計画テンプレートをファイルに戻す
>tendril config get planTemplate > template.md
```

> [!TIP]
> `planTemplate` などの複数行テキストや `llm` などの [JSON](https://www.json.org) オブジェクトを割り当てる場合は、シェルの引用符またはコマンド置換（`"$(cat file.md)"`）を使用して、値が単一の引数として明確に渡されるようにしてください。
