---
title: コーディングエージェント
description: コーディングエージェントは、Tendril の計画を実行する AI 駆動のランタイムです。エージェントの選択、プロファイルの設定、エージェントスキルのインストールを行い、Tendril に作業をオーケストレーションさせます。
icon: Bot
groupExpanded: true
searchHints:
  - コーディングエージェント
  - エージェント
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - スキル
---

# コーディングエージェント

コーディングエージェントは、Tendril の[計画 (plans)](../02_Concepts/01_Plans.md)を実行する AI 駆動のランタイムです。エージェントを選択し、プロファイルを設定し、エージェントスキルをインストールして、Tendril に作業のオーケストレーションを任せましょう。

- [エージェントスキル](00_Skills.md) — 自律型 AI コーディングエージェント向けのエンジニアリング、デバッグ、レビューのワークフローをパッケージ化。
- [Claude Code](01_ClaudeCode.md) — Tendril のデフォルトのコーディングエージェント。[Anthropic Claude](https://code.claude.com/docs) モデルを搭載。
- [Codex](02_Codex.md) — [OpenAI](https://openai.com) GPT モデルを搭載した代替コーディングエージェント。
- [Copilot](03_Copilot.md) — GitHub の [Copilot CLI](https://github.com/features/copilot) を利用したコーディングエージェント。
- [OpenCode](04_OpenCode.md) — 多様な推論バックエンドをサポートするマルチプロバイダーのコーディングエージェント。
- [Gemini CLI](05_Gemini.md) — Google [Gemini](https://ai.google.dev) モデルを搭載したコーディングエージェント。

## 環境変数

`config.yaml` を介して、コーディングエージェントのプロセスに環境変数を注入できます。これらはジョブの実行（[計画](../02_Concepts/01_Plans.md)）と対話型エージェントタブ（PTY）の両方に適用されます。設定オプションの詳細については、[セットアップと設定](../03_Configuration/01_Setup.md)を参照してください。

```yaml
codingAgents:
  - name: claude
    environmentVariables:
      CLAUDE_CODE_USE_BEDROCK: "1"
      ANTHROPIC_BASE_URL: "https://your-endpoint.example.com"
    profiles:
      - name: balanced
        model: sonnet
        effort: high
```

`environmentVariables` 以下のキー/値ペアは、エージェントが起動する前にそのプロセス環境に設定されます。これはプロバイダーの設定（例: [AWS Bedrock](https://aws.amazon.com/bedrock/)、カスタム API エンドポイント）や、エージェント CLI がサポートするランタイムフラグに使用します。
