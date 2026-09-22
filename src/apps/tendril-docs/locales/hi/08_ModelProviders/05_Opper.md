---
title: Opper.ai
description: Anthropic, OpenAI, Google और ओपन-वेट प्रदाताओं के 300+ मॉडल्स तक
  पहुंच प्रदान करने वाला AI गेटवे, जिसमें EU डेटा रेजीडेंसी विकल्प उपलब्ध हैं।
icon: Server
searchHints:
  - opper
  - गेटवे
  - eu
  - मल्टी-प्रोवाइडर
  - राउटर
---

# Opper.ai

[Opper.ai](https://opper.ai) यूरोप में मुख्यालय वाला एक एंटरप्राइज AI गेटवे है जो [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Mistral AI](https://mistral.ai) और ओपन-सोर्स इकोसिस्टम के 300 से अधिक फाउंडेशन मॉडल्स तक एकीकृत पहुंच प्रदान करता है। Opper में स्वचालित फॉलबैक राउटिंग, लेटेंसी ऑप्टिमाइज़ेशन और सख्त EU डेटा रेजीडेंसी नियंत्रण शामिल हैं।

## Opper CLI के माध्यम से सेटअप

1. Opper CLI इंस्टॉल करें ([Node.js](https://nodejs.org) आवश्यक है):
   ```bash
   npm i -g @opperai/cli
   ```
2. ब्राउज़र OAuth का उपयोग करके साइन इन करें:
   ```bash
   opper login
   ```
3. Opper के माध्यम से [OpenCode](https://opencode.ai) लॉन्च करें:
   ```bash
   opper launch opencode
   ```

प्रमाणीकरण Opper CLI सत्र द्वारा प्रबंधित किया जाता है; व्यक्तिगत प्रदाता API कुंजियों की आवश्यकता नहीं है।

## मॉडल्स बदलना

आप `--model` फ़्लैग का उपयोग करके लॉन्च के समय एक मॉडल निर्दिष्ट कर सकते हैं:

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

या सक्रिय OpenCode सत्र के दौरान `/models` का उपयोग करके इंटरैक्टिव रूप से मॉडल्स बदल सकते हैं।

## Tendril के साथ उपयोग करना

### विकल्प A: बंडल किए गए OpenCode के माध्यम से

1. Tendril डेस्कटॉप एप्लिकेशन में, **Settings > Coding Agent** पर जाएं।
2. **OpenCode** को अपने सक्रिय कोडिंग एजेंट के रूप में सेट करें ([OpenCode Agent](../06_CodingAgents/04_OpenCode.md) देखें)।
3. Tendril, Opper के माध्यम से रूट करते हुए OpenCode द्वारा निष्पादन भेजता है।

### विकल्प B: `config.yaml` में सीधा गेटवे

Opper `https://api.opper.ai/v1` पर OpenAI-संगत गेटवे भी प्रदान करता है। आप `~/.tendril/config.yaml` में अपनी Opper API कुंजी प्रदान करके सीधे कनेक्ट करने के लिए Tendril को कॉन्फ़िगर कर सकते हैं ([Configuration Setup](../03_Configuration/01_Setup.md) देखें):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "opp_..."
      OPENAI_BASE_URL: "https://api.opper.ai/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: medium
```

> [!TIP]
> जब आपके Opper डैशबोर्ड में EU रेजीडेंसी नीतियां सक्षम होती हैं, तो Opper स्वचालित रूप से प्रॉम्प्ट प्रीफिक्स को कैश करता है और प्रश्नों को यूरोपीय डेटा क्षेत्रों में रूट करता है।

## लिंक्स

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Opper Platform](https://opper.ai)
- [Opper Agent CLI Documentation](https://opper.ai/agent-cli)
