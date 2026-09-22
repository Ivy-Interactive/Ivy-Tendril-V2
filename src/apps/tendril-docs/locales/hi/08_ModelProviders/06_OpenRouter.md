---
title: OpenRouter
description: एकीकृत API गेटवे जो Anthropic, OpenAI, Google, xAI, Meta, DeepSeek,
  और अन्य के मॉडल्स तक पहुँच प्रदान करता है।
icon: Globe
searchHints:
  - ओपनराउटर
  - राउटर
  - मल्टी-प्रोवाइडर
  - गेटवे
---

# OpenRouter

[OpenRouter](https://openrouter.ai) एक एकीकृत, [OpenAI](https://openai.com)-संगत API गेटवे प्रदान करता है जो [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google DeepMind](https://deepmind.google), [Meta AI](https://ai.meta.com), [Mistral AI](https://mistral.ai), [DeepSeek](https://www.deepseek.com), और [xAI](https://x.ai) से सैकड़ों अग्रणी (frontier) मॉडल्स तक पहुँच प्रदान करता है। OpenRouter प्रतिस्पर्धी प्रति-टोकन मूल्य निर्धारण, स्वचालित प्रोवाइडर फ़ॉलबैक और व्यापक उपयोग मेट्रिक्स प्रदान करता है।

## OpenCode के माध्यम से सेटअप

1. [openrouter.ai/keys](https://openrouter.ai/keys) पर एक API key बनाएँ (keys `sk-or-` से शुरू होती हैं)।
2. टर्मिनल या Tendril के एम्बेडेड टर्मिनल के माध्यम से [OpenCode](https://opencode.ai) लॉन्च करें:
   ```bash
   opencode
   ```
   `/connect` टाइप करें, **OpenRouter** चुनें, और अपनी API key पेस्ट करें।
3. `/models` का उपयोग करके अपने सक्रिय मॉडल को बदलें।

### प्रोजेक्ट कॉन्फ़िगरेशन (`opencode.json`)

आप `opencode.json` में प्रोजेक्ट-स्तरीय डिफ़ॉल्ट मॉडल परिभाषित कर सकते हैं:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "~anthropic/claude-sonnet-5": {},
        "~google/gemini-3.8-flash": {},
        "~deepseek/deepseek-r1": {}
      }
    }
  }
}
```

## Tendril के साथ उपयोग करना

आप डेस्कटॉप UI या `config.yaml` का उपयोग करके Tendril v2 को सीधे OpenRouter से कनेक्ट कर सकते हैं।

### विकल्प A: डेस्कटॉप सेटिंग्स (Bring Your Own LLM)

1. Tendril ऐप में **Settings > Coding Agent** पर जाएँ।
2. **Bring Your Own LLM** के अंतर्गत, **OpenAI** कार्ड पर क्लिक करें।
3. **Base URL** को `https://openrouter.ai/api/v1` पर सेट करें।
4. अपनी OpenRouter key (`sk-or-...`) को **API Key** में दर्ज करें और **Save** पर क्लिक करें।

### विकल्प B: `config.yaml` में मैन्युअल कॉन्फ़िगरेशन

`~/.tendril/config.yaml` में `codingAgents` के तहत OpenRouter को कॉन्फ़िगर करें (देखें [कॉन्फ़िगरेशन सेटअप](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-or-..."
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1"
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

> [!TIP]
> OpenRouter मॉडल ID में वेंडर प्रीफ़िक्स शामिल होते हैं (उदाहरण के लिए, `anthropic/claude-opus-5` या `deepseek/deepseek-r1`)। इन प्रीफ़िक्स को आपके प्रोफ़ाइल `model` फ़ील्ड में यथावत (verbatim) शामिल किया जाना चाहिए।

## लिंक्स

- [मॉडल प्रोवाइडर्स](_Index.md)
- [कोडिंग एजेंट्स](../06_CodingAgents/_Index.md)
- [OpenRouter प्लेटफ़ॉर्म](https://openrouter.ai)
- [OpenRouter + OpenCode एकीकरण गाइड](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
