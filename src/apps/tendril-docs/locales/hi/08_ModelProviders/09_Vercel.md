---
title: वर्सेल एआई गेटवे
description: बिल्ट-इन ऑब्जर्वेबिलिटी के साथ OpenAI, Anthropic, Google और ओपन-वेट
  मॉडल्स के एकीकृत एक्सेस के लिए वर्सेल के एआई गेटवे के माध्यम से अनुरोधों को
  रूट करें।
icon: Zap
searchHints:
  - वर्सेल
  - एआई गेटवे
  - एकीकृत
  - ऑब्जर्वेबिलिटी
---

# वर्सेल एआई गेटवे

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) प्रमुख मॉडल प्रदाताओं जैसे कि [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), और [xAI](https://x.ai) में इनफेरेंस अनुरोधों को रूट करने के लिए एक एकीकृत प्रॉक्सी प्रदान करता है। इसमें केंद्रीकृत एपीआई कुंजी प्रबंधन, एज कैशिंग, रीयल-टाइम टेलीमेट्री और दर-सीमा (रेट-लिमिट) सुरक्षा उपाय शामिल हैं।

## OpenCode के माध्यम से सेटअप

1. अपनी टीम के **AI Gateway > API keys** के तहत [Vercel Dashboard](https://vercel.com) में एक API कुंजी बनाएं।
2. टर्मिनल या Tendril के एम्बेडेड PTY का उपयोग करके [OpenCode](https://opencode.ai) में कनेक्ट करें:
   ```bash
   opencode
   ```
   `/connect` टाइप करें, **Vercel AI Gateway** खोजें, और अपनी API कुंजी दर्ज करें।
3. `/models` का उपयोग करके अपना सक्रिय मॉडल बदलें।

### रूटिंग नियम (`opencode.json`)

आप सीधे `opencode.json` में फेलओवर क्रम और रूटिंग प्राथमिकताएं परिभाषित कर सकते हैं:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "vercel": {
      "models": {
        "anthropic/claude-sonnet-5": {
          "options": {
            "order": ["anthropic", "vertex"]
          }
        }
      }
    }
  }
}
```

## Tendril के साथ उपयोग करना

### विकल्प A: बंडल किए गए OpenCode के माध्यम से

1. Tendril डेस्कटॉप एप्लिकेशन में, **Settings > Coding Agent** पर जाएं।
2. अपने सक्रिय एजेंट के रूप में **OpenCode** चुनें (देखें [OpenCode एजेंट](../06_CodingAgents/04_OpenCode.md))।
3. Tendril वर्सेल एआई गेटवे से जुड़े बंडल किए गए [OpenCode](https://opencode.ai) साइडकार के माध्यम से सभी योजना निष्पादन को रूट करता है।

### विकल्प B: `config.yaml` में सीधा गेटवे

Vercel AI Gateway `https://ai-gateway.vercel.sh/v1` पर एक [OpenAI](https://openai.com)-संगत API एंडपॉइंट प्रदान करता है। आप Tendril को `~/.tendril/config.yaml` में सीधे इसके माध्यम से रूट करने के लिए कॉन्फ़िगर कर सकते हैं (देखें [कॉन्फ़िगरेशन सेटअप](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-vercel-ai-key"
      OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: low
```

## मॉनिटरिंग और टेलीमेट्री

उपयोग मेट्रिक्स, टोकन खपत, और लेटेंसी विवरण स्वचालित रूप से वर्सेल डैशबोर्ड में **AI Gateway > Analytics** के तहत लॉग किए जाते हैं, जो Tendril के स्थानीय टोकन लेज़र के पूरक के रूप में काम करते हैं।

## लिंक्स

- [मॉडल प्रदाता](_Index.md)
- [कोडिंग एजेंट्स](../06_CodingAgents/_Index.md)
- [Vercel AI Gateway दस्तावेज़ीकरण](https://vercel.com/docs/ai-gateway)
- [Vercel + OpenCode गाइड](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
