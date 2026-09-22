---
title: GitHub
description: Tendril は GitHub と連携して、Issue のインポート、PR の自動作成、PR ステータスの追跡を行います。
icon: GitBranch
searchHints:
  - github
  - issues
  - pull requests
  - prs
  - import
  - イシュー
  - プルリクエスト
---

# GitHub

## 認証

Tendril は [GitHub CLI](https://cli.github.com)（`gh`）を使用して [GitHub](https://github.com) との認証を行います。GitHub 機能を使用する前に `gh auth login` を実行して認証してください。

> [!NOTE]
> `gh` がインストールされ、PATH 上で利用可能であることを確認してください。見つからない場合、Tendril はオンボーディング中にプロンプトを表示します。

## 受信トレイ経由での Issue のインポート

Tendril はサイドバーに専用の **Inbox**（受信トレイ）ビューを提供し、[GitHub](https://github.com) Issue を参照して[計画](../02_Concepts/01_Plans.md)に変換できるようにします:

1. ナビゲーションサイドバーから **Inbox** を開きます。
2. カテゴリを選択します:
   - **My Issues**: 設定されたプロジェクトリポジトリ全体で、自分に割り当てられた Issue。
   - **Review Requests**: あなたのレビューを要求している未完了のプルリクエスト。
   - **Project Issues**: 選択したプロジェクトリポジトリのすべての未完了 Issue。
3. 検索キーワード、ラベル、またはマイルストーンで絞り込みます。1 回のクエリで最大 1,000 件のオープンな Issue（GitHub の検索上限）を取得できます。
4. 1 つ以上の Issue を選択し、**Create Plan**（計画作成）をクリックして `CreatePlan` [プロンプトウェア](../02_Concepts/02_Promptwares.md)を起動するか、実行前に「新規計画」ダイアログで計画の説明をカスタマイズします。

作成された各計画には、元の GitHub Issue に直接戻るリンクとなるソース URL が保持されます。

### 自動 Issue スイープと提案

Tendril には、割り当てられた GitHub Issue をバックグラウンドで自動的にスイープ（定期確認）する機能が含まれています:

- `inbox.checkIntervalMinutes` を設定（または Inbox ビューの設定ギアをクリック）して、Tendril が新しく割り当てられた Issue を GitHub に問い合わせる頻度を設定します。
- **自動承認モード (Auto-Accept Mode)**: `inbox.autoAcceptAssignedIssues` が有効になっている場合、新しく検出された Issue は直ちに `CreatePlan` ジョブを開始します。
- **提案モード (Proposals Mode)**: 無効になっている場合、スイープされた Issue は Inbox ビューに **Inbox Proposals**（受信トレイの提案）としてステージングされます。各提案の説明を確認し、**Accept**（承認して計画を開始）または **Dismiss**（却下して永続的な記録を残し、Issue が再インポートされないようにする）を選択できます。
- Inbox ツールバーの **Check Now**（今すぐ確認）をクリックすると、スケジュールされたタイマーを待たずに即座に手動スイープをトリガーできます。

## Pull Request の作成

計画が完了し、変更が検証されたら、**Create PR** ダイアログを開いてプルリクエストを作成します:

1. 生成された PR のタイトル、説明、レビュアーを確認および編集します。
2. PR オプションを設定します:
   - **Solve Merge Conflicts**: ターゲットベースに対するブランチのマージコンフリクトの自動解決を試みます。
   - **Merge**: チェックに合格したら PR を自動マージします（マージせずにチームレビュー用に PR を開く場合はチェックを外します）。
   - **Delete Branch**: マージ後にワークツリーブランチを削除します。
   - **Include Artifacts**: 計画の検証成果物、スクリーンショット、およびログを PR 本文に添付します。
   - **Create as Draft**: ドラフト状態でプルリクエストを作成します。
3. Tendril は `gh` 経由で `CreatePr` [プロンプトウェア](../02_Concepts/02_Promptwares.md)を実行し、ブランチをプッシュしてプルリクエストを作成し、PR の URL を計画にリンクします。

## PR ステータスの追跡

サイドバーの [Pull Requests ビュー](../04_Apps/06_PullRequests.md) は、プロジェクト全体のすべてのオープン、マージ済み、およびクローズされたプルリクエストを追跡します。Tendril は PR の状態変化を監視し、手動で介入することなく [計画ボード](../04_Apps/03_Plans.md) を常に最新の状態に同期します。
