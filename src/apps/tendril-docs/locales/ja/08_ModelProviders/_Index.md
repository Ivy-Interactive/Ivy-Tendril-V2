---
title: モデルプロバイダー
description: 組み込みの BYO カードまたは同梱の OpenCode サイドカーを使用して、Tendril v2 エージェント用のモデルプロバイダーと推論バックエンドを設定します。
icon: Server
groupExpanded: true
searchHints:
  - モデルプロバイダー
  - プロバイダー
  - api
  - 推論
  - ゲートウェイ
  - llm
  - opencode
  - bring your own llm
  - byo
---

# モデルプロバイダー

Tendril v2 は柔軟なモデルプロバイダールーティングをサポートしており、欧州の主権インフラ、統合 API ゲートウェイ、クラウドモデルハブ、またはローカルのオンプレミスエンドポイントに対して [コーディングエージェント](../06_CodingAgents/_Index.md) を実行できます。

Tendril v2 におけるモデルプロバイダーの実行ルーティングには、主に 2 つのメカニズムがあります：

1. **ネイティブの Bring Your Own LLM (BYO LLM)**: [OpenAI](https://openai.com)、[Anthropic](https://www.anthropic.com)、および欧州の主権プロバイダーである [Berget AI](01_Berget.md) 向けの組み込み設定カードと、`config.yaml` での直接 [設定](../03_Configuration/01_Setup.md)。
2. **同梱の OpenCode サイドカー**: Tendril v2 には [OpenCode](https://opencode.ai) バイナリが標準でバンドルされており（`binaries/opencode`）、手動で CLI をインストールすることなく、マルチプロバイダーゲートウェイやカスタム推論バックエンドに直接アクセスできます（[OpenCode エージェント](../06_CodingAgents/04_OpenCode.md) を参照）。

## サポートされているプロバイダー

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — 完全な EU データレジデンシーと Tendril ファーストクラス BYO カード統合を提供する、欧州の AI インフラストラクチャプロバイダー（Kimi および GLM モデル）。
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — Kimi、Llama、Mistral などのオープンソースコーディングモデルを提供する欧州のソブリンクラウドプロバイダー。
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — 専用のコーディングプランオプションを備えた、GLM モデルへの高スループットアクセス。
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — コーディングおよび推論向けの OpenAI 互換 Generative API を提供する欧州のクラウドプロバイダー。
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — EU データレジデンシーオプションを備え、300 以上のモデルへの統合アクセスを提供する AI ゲートウェイ。
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — Anthropic、OpenAI、Google、Meta、DeepSeek などのモデルへのアクセスを提供する統合 API ゲートウェイ。
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — Workers MCP ツール統合と連動した、Cloudflare Workers AI によるサーバーレス推論。
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — NVIDIA Build 上でホストされる、エンタープライズグレードの [NVIDIA NIM](https://build.nvidia.com) マイクロサービスおよびオープンモデル。
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — 組み込みテレメトリ、支出ガードレール、リクエストキャッシュを備えた統合マルチプロバイダールーティング。

## 設定の仕組み

### 1. Tendril デスクトップアプリでの設定

**Settings > Coding Agent** に移動します：

- **事前設定済みエージェント**: [Claude Code](../06_CodingAgents/01_ClaudeCode.md)、[Copilot](../06_CodingAgents/03_Copilot.md)、[Codex](../06_CodingAgents/02_Codex.md)、[Gemini](../06_CodingAgents/05_Gemini.md)、[Antigravity](https://antigravity.google)、[OpenCode](../06_CodingAgents/04_OpenCode.md)、[Cursor](https://cursor.com)、[Apple オンデバイスモデル](https://developer.apple.com) などの同梱エージェントから選択します。
- **Bring Your Own LLM カード**: **OpenAI**、**Anthropic**、または **Berget AI** を選択します。API キーを入力すると、Tendril が適切なベース URL を自動的に設定し、それぞれの SDK 環境変数に分割して、ティアプロファイルのデフォルト値を適用します。
- **プロファイルティア**: 3 つの実行ティアにわたって、デフォルトモデルと推論エフォート（reasoning effort）レベルを設定します：
  - **Deep**: アーキテクチャの計画、複雑なリファクタリング、初期ドラフト向けの高度な推論。
  - **Balanced**: 日常的な機能実装やレビュー修正向けの、能力と速度のバランスが取れた設定。
  - **Quick**: コミットメッセージの生成、テストの検証、ステータスチェック向けの高速・低遅延モデル。

### 2. `config.yaml` での設定

すべてのプロバイダーおよびエージェントの設定は `~/.tendril/config.yaml` に保存されます（[設定のセットアップ](../03_Configuration/01_Setup.md) を参照）：

```yaml
codingAgent: openaiproxy # または opencode, claude, codex, gemini など

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-..."
      OPENAI_BASE_URL: "https://api.openai.com/v1"
      ANTHROPIC_API_KEY: "sk-..."
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    profiles:
      - name: deep
        model: "gpt-5.6-sol"
        effort: high
      - name: balanced
        model: "gpt-5.6-terra"
        effort: medium
      - name: quick
        model: "gpt-5.6-luna"
        effort: low
```

> [!TIP]
> BYO 設定を保存する際、Tendril のデーモンはベース URL を自動的に同期します。[OpenAI](https://openai.com) SDK は URL の末尾に `/v1` を要求しますが、[Anthropic](https://www.anthropic.com) SDK は `/v1` のないホスト名のみを要求します。

### 3. 同梱の OpenCode サイドカー経由

ゲートウェイプロバイダー（[OpenRouter](06_OpenRouter.md)、[Evroc](02_Evroc.md)、[Scaleway](04_Scaleway.md)、[Opper](05_Opper.md) など）の場合：

1. ターミナルまたは Tendril の組み込みターミナルから OpenCode を起動します：
   ```bash
   opencode
   ```
2. `/connect` と入力してプロバイダーを選択するか、`opencode auth login` を実行します。
3. Tendril の **Settings > Coding Agent** で、アクティブなコーディングエージェントを OpenCode に設定します（`codingAgent: opencode`）。
4. Tendril は、設定された [OpenCode](../06_CodingAgents/04_OpenCode.md) ランタイムを通じてすべての計画実行タスクをディスパッチします。

> [!NOTE]
> Tendril v2 は [models.dev](https://models.dev) を通じて利用可能なモデルのメタデータを自動的に拡充します。キャッシュは [SQLite](https://www.sqlite.org) にローカル保存され、バックグラウンドまたは `POST /api/models/refresh` によるオンデマンドで更新されます。
