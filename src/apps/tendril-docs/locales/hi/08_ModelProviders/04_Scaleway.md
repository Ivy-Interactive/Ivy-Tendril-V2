---
title: Scaleway
description: कोडिंग, रीज़निंग और ओपन-वेट मॉडल्स के लिए OpenAI-संगत जेनेरेटिव API
  प्रदान करने वाला यूरोपीय क्लाउड प्रदाता।
icon: Server
searchHints:
  - scaleway
  - ईयू (eu)
  - यूरोपीय (european)
  - जेनेरेटिव एपीआई (generative apis)
  - संप्रभु (sovereign)
  - qwen
---

# Scaleway

[Scaleway](https://www.scaleway.com) एक प्रमुख यूरोपीय क्लाउड सेवा प्रदाता है जो फ्रांस, नीदरलैंड और पोलैंड में स्थित ऊर्जा-कुशल डेटा केंद्रों में होस्ट किए गए संप्रभु (sovereign) AI इन्फ्रास्ट्रक्चर की पेशकश करता है। अपने Generative APIs प्लेटफ़ॉर्म के माध्यम से, Scaleway प्रमुख ओपन मॉडल्स के लिए प्रबंधित (managed), पूरी तरह से [OpenAI](https://openai.com)-संगत एंडपॉइंट्स प्रदान करता है।

## सेटअप (Setup)

1. [scaleway.com](https://www.scaleway.com) पर एक खाता बनाएं।
2. Scaleway कंसोल में **Identity and Access Management (IAM)** के तहत एक IAM API key (Secret Key) जनरेट करें।
3. बंडल किए गए साइडकार या टर्मिनल का उपयोग करके [OpenCode](https://opencode.ai) में कनेक्ट करें:
   ```bash
   opencode
   ```
   `/connect` टाइप करें, **Scaleway** चुनें, और अपनी IAM Secret Key पेस्ट करें।
4. `/models` का उपयोग करके एक मॉडल चुनें।

## अनुशंसित मॉडल्स (Recommended Models)

Scaleway कोड पूर्णता (code completion) और सॉफ़्टवेयर इंजीनियरिंग के लिए अनुकूलित कई मॉडल्स होस्ट करता है:

| मॉडल                       | मॉडल ID                           | निर्माता                             | अनुशंसित टियर    |
| :------------------------- | :-------------------------------- | :----------------------------------- | :--------------- |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep             |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced         |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick            |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Reasoning) |

## Tendril के साथ उपयोग

### विकल्प A: बंडल किए गए OpenCode के माध्यम से

1. Tendril डेस्कटॉप ऐप में, **Settings > Coding Agent** पर जाएं।
2. अपने सक्रिय एजेंट के रूप में **OpenCode** चुनें (देखें [OpenCode Agent](../06_CodingAgents/04_OpenCode.md))।
3. OpenCode सभी योजना निष्पादन (plan execution) कार्यों के लिए आपके कॉन्फ़िगर किए गए Scaleway क्रेडेंशियल्स का उपयोग करेगा।

### विकल्प B: `config.yaml` में कस्टम OpenAI एंडपॉइंट

चूंकि Scaleway के Generative APIs `https://api.scaleway.ai/v1` पर OpenAI विनिर्देश (specification) का पालन करते हैं, आप इसे सीधे `~/.tendril/config.yaml` में कॉन्फ़िगर कर सकते हैं (देखें [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-scaleway-secret-key"
      OPENAI_BASE_URL: "https://api.scaleway.ai/v1"
    profiles:
      - name: deep
        model: "qwen2.5-coder-32b-instruct"
        effort: high
      - name: balanced
        model: "llama-3.3-70b-instruct"
        effort: medium
      - name: quick
        model: "mistral-small-24b-instruct-2501"
        effort: low
```

> [!NOTE]
> Scaleway मानक HTTP Bearer टोकन प्रमाणीकरण लागू करता है। आपकी IAM Secret Key सीधे `OPENAI_API_KEY` के रूप में कार्य करती है।

## लिंक्स (Links)

- [मॉडल प्रदाता](_Index.md)
- [कोडिंग एजेंट्स](../06_CodingAgents/_Index.md)
- [Scaleway प्लेटफ़ॉर्म](https://www.scaleway.com)
- [Scaleway कंसोल](https://console.scaleway.com)
- [Scaleway Generative APIs दस्तावेज़ीकरण](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
