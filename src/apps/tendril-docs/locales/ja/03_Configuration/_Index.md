---
title: 設定
description: Tendril の設定、環境変数、デーモンオプション、およびプロジェクトプロファイルを構成します。
icon: Settings
groupExpanded: true
searchHints:
  - 設定
  - コンフィグ
  - オプション
  - 環境設定
  - 環境変数
---

# 設定

Tendril は、その設定、プロジェクト、および実行環境設定を `$TENDRIL_HOME/config.yaml` にある一元化された [YAML](https://yaml.org) 設定ファイルに保存します。

このセクションでは、グローバルな Tendril 環境の構成、[プロジェクト設定](02_Projects.md) の管理、デーモン設定の調整、および [コーディングエージェント](../06_CodingAgents/_Index.md) プロファイルのセットアップについて説明します：

- [セットアップと設定](01_Setup.md) — 設定 UI または `$TENDRIL_HOME/config.yaml` でグローバルオプションを構成し、[コーディングエージェント](../06_CodingAgents/_Index.md)、セッション認証、[Cloudflare](https://www.cloudflare.com) トンネル、および組み込みの [検証ゲート](01_Setup.md#verifications) を管理します。
- [プロジェクト設定](02_Projects.md) — [Git](https://git-scm.com) リポジトリの登録、視覚的なカラースウォッチの構成、検証パイプライン、レビューアクション、ポート割り当て、[Docker](https://www.docker.com) サンドボックス、[MCP](../09_Advanced/03_MCP.md) サーバー、および [Git ワークツリー](02_Projects.md#repositories--git-worktrees) の分離を構成します。

計画とプロンプトウェアがどのように機能するかについての概念的な背景については、[計画](../02_Concepts/01_Plans.md)、[プロンプトウェア](../02_Concepts/02_Promptwares.md)、および [計画ライフサイクル](../02_Concepts/03_Lifecycle.md) を参照してください。
