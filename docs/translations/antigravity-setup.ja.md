# Google Antigravity 向け Tendril Skills セットアップガイド

このガイドでは、Google Antigravity CLI（`agy`）および Antigravity IDE で Tendril スキルをインストールして使用する方法について説明します。

## 1. Antigravity CLI のインストール

Tendril は `.agents/plugins/marketplace.json` に Antigravity プラグインマニフェストを提供しています。

### リモート Git リポジトリからのインストール
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### ローカルリポジトリチェックアウトからのインストール
ローカル開発中、または Ivy-Tendril-V2 チェックアウト内でのインストール：
```bash
agy plugin install ./
```

## 2. プラグインの検証と検出

プラグインとそれに関連付けられたスキルが読み込まれていることを確認します：

```bash
# インストール済みプラグインの一覧表示
agy plugin list

# 利用可能なスキルの一覧表示
agy skill list
```

同梱されている Tendril スキルが表示されます：
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. Antigravity でのスキル呼び出し

対話型の Antigravity エージェントセッションや自動スクリプト内で使用できます：

- Antigravity に計画（Plan）のデバッグを依頼する：
  ```
  Use tendril-debug-plan to investigate plan 00516
  ```
- 保留中のワークツリー差分をレビューする：
  ```
  Run tendril-review on the current changes
  ```
- バックログの候補課題をトリアージする：
  ```
  Run tendrillable on https://github.com/ivy-interactive/ivy-tendril-v2 5
  ```

## 4. Antigravity IDE との連携

Antigravity IDE 内で作業する場合：
1. ワークスペースのルートにある `.agents/skills/` ディレクトリに配置されたスキルは自動的にインデックスされます。
2. Ivy Tendril 拡張機能を Antigravity IDE にリンクするには：
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. Antigravity IDE をリロードします（`Cmd+Shift+P` -> `Developer: Reload Window`）。

## ライセンス

Tendril のスキルおよびプラグインは、リポジトリルートの [Functional Source License (FSL-1.1-ALv2)](../LICENSE) の下でライセンスされています。
