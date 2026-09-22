---
title: मॉडल प्रदाता
description: इन-बिल्ट BYO कार्ड या बंडल किए गए OpenCode साइडकार का उपयोग करके
  Tendril v2 एजेंटों के लिए मॉडल प्रदाताओं और इनफेरेंस बैकएंड को कॉन्फ़िगर करें।
icon: Server
groupExpanded: true
searchHints:
  - मॉडल प्रदाता
  - प्रदाता
  - एपीआई
  - इनफेरेंस
  - गेटवे
  - एलएलएम
  - opencode
  - अपना खुद का एलएलएम लाएं
  - byo
---

# मॉडल प्रदाता

Tendril v2 लचीले मॉडल प्रदाता रूटिंग का समर्थन करता है, जिससे आप यूरोपीय संप्रभु अवसंरचना (European sovereign infrastructure), एकीकृत API गेटवे, क्लाउड मॉडल हब या स्थानीय ऑन-प्रिमाइसेस एंडपॉइंट्स पर [कोडिंग एजेंट](../06_CodingAgents/_Index.md) चला सकते हैं।

Tendril v2 में, मॉडल प्रदाता निष्पादन दो प्राथमिक तंत्रों के माध्यम से रूट होता है:

1. **मूल Bring Your Own LLM (BYO LLM)**: [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com), और यूरोपीय संप्रभु प्रदाता [Berget AI](01_Berget.md) के लिए इन-बिल्ट सेटिंग्स कार्ड और `config.yaml` में सीधा [कॉन्फ़िगरेशन](../03_Configuration/01_Setup.md)।
2. **बंडल किया गया OpenCode साइडकार**: Tendril v2 आउट-ऑफ़-द-बॉक्स बंडल किए गए [OpenCode](https://opencode.ai) बाइनरी (`binaries/opencode`) के साथ आता है, जो मैन्युअल CLI इंस्टॉलेशन की आवश्यकता के बिना मल्टी-प्रदाता गेटवे और कस्टम इनफेरेंस बैकएंड तक सीधी पहुंच प्रदान करता है (देखें [OpenCode एजेंट](../06_CodingAgents/04_OpenCode.md))।

## समर्थित प्रदाता

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — यूरोपीय AI अवसंरचना प्रदाता जो पूर्ण EU डेटा निवास और प्रथम श्रेणी Tendril BYO कार्ड एकीकरण के साथ Kimi और GLM मॉडल प्रदान करता है।
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — यूरोपीय संप्रभु क्लाउड प्रदाता जिसमें Kimi, Llama और Mistral सहित ओपन-सोर्स कोडिंग मॉडल शामिल हैं।
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — समर्पित कोडिंग योजना विकल्पों के साथ GLM मॉडल के लिए उच्च-थ्रूपुट पहुंच।
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — यूरोपीय क्लाउड प्रदाता जो कोडिंग और रीज़निंग के लिए OpenAI-संगत जनरेटिव API प्रदान करता है।
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — AI गेटवे जो EU डेटा निवास विकल्पों के साथ 300+ मॉडलों तक एकीकृत पहुंच प्रदान करता है।
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — Anthropic, OpenAI, Google, Meta और DeepSeek के मॉडलों तक पहुंच प्रदान करने वाला एकीकृत API गेटवे।
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — Workers MCP टूल एकीकरण के साथ Cloudflare Workers AI के माध्यम से सर्वर रहित (सर्वरलेस) इनफेरेंस।
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — एंटरप्राइज़-ग्रेड [NVIDIA NIM](https://build.nvidia.com) माइक्रोसर्विसेज़ और NVIDIA Build पर होस्ट किए गए ओपन मॉडल।
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — इन-बिल्ट टेलीमेट्री, खर्च सीमा (spend guardrails), और अनुरोध कैशिंग के साथ एकीकृत मल्टी-प्रदाता रूटिंग।

## कॉन्फ़िगरेशन कैसे काम करता है

### 1. Tendril डेस्कटॉप ऐप में

**Settings > Coding Agent** पर नेविगेट करें:

- **पहले से कॉन्फ़िगर किए गए एजेंट**: [Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com), और [Apple ऑन-डिवाइस मॉडल](https://developer.apple.com) सहित बंडल किए गए एजेंटों में से चुनें।
- **Bring Your Own LLM कार्ड**: **OpenAI**, **Anthropic**, या **Berget AI** चुनें। अपनी API कुंजी दर्ज करें, और Tendril स्वचालित रूप से उपयुक्त बेस URL कॉन्फ़िगर करता है, उन्हें संबंधित SDK वातावरण चर (environment variables) में विभाजित करता है, और टियर वाले प्रोफ़ाइल डिफॉल्ट्स को पॉप्युलेट करता है।
- **प्रोफ़ाइल टियर**: तीन निष्पादन स्तरों में डिफ़ॉल्ट मॉडल और रीज़निंग प्रयास स्तरों को कॉन्फ़िगर करें:
  - **Deep**: आर्किटेक्चरल योजना, जटिल रीफैक्टरिंग और प्रारंभिक ड्राफ्ट के लिए उच्च-प्रयास रीज़निंग।
  - **Balanced**: दैनिक सुविधा कार्यान्वयन और समीक्षा सुधारों के लिए संतुलित क्षमता और गति।
  - **Quick**: कमिट संदेश निर्माण, परीक्षण सत्यापन और स्थिति जांच के लिए तेज़, कम-विलंबता वाले मॉडल।

### 2. `config.yaml` में

सभी प्रदाता और एजेंट सेटिंग्स `~/.tendril/config.yaml` में सुरक्षित रखी जाती हैं (देखें [कॉन्फ़िगरेशन सेटअप](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy # or opencode, claude, codex, gemini, etc.

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
> BYO सेटिंग्स को सहेजते समय, Tendril का डेमॉन स्वचालित रूप से बेस URL को सिंक्रनाइज़ करता है: [OpenAI](https://openai.com) SDK URL के अंत में `/v1` की अपेक्षा करता है, जबकि [Anthropic](https://www.anthropic.com) SDK बिना `/v1` के केवल होस्ट की अपेक्षा करता है।

### 3. बंडल किए गए OpenCode साइडकार के माध्यम से

गेटवे प्रदाताओं के लिए (जैसे [OpenRouter](06_OpenRouter.md), [Evroc](02_Evroc.md), [Scaleway](04_Scaleway.md), या [Opper](05_Opper.md)):

1. टर्मिनल के माध्यम से या Tendril के एम्बेडेड टर्मिनल के माध्यम से OpenCode लॉन्च करें:
   ```bash
   opencode
   ```
2. `/connect` टाइप करें और अपना प्रदाता चुनें, या `opencode auth login` चलाएं।
3. **Settings > Coding Agent** के अंतर्गत Tendril में अपने सक्रिय कोडिंग एजेंट को OpenCode पर सेट करें (`codingAgent: opencode`)।
4. Tendril सभी योजना निष्पादन कार्यों को कॉन्फ़िगर किए गए [OpenCode](../06_CodingAgents/04_OpenCode.md) रनटाइम के माध्यम से भेजता है।

> [!NOTE]
> Tendril v2 [models.dev](https://models.dev) के माध्यम से उपलब्ध मॉडल मेटाडेटा को स्वचालित रूप से समृद्ध करता है। कैश स्थानीय रूप से [SQLite](https://www.sqlite.org) में संग्रहीत होता है और पृष्ठभूमि में या `POST /api/models/refresh` के माध्यम से मांग पर रीफ्रेश होता है।
