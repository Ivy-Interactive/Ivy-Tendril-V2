---
title: Evroc
description: Kimi, Llama और Mistral सहित ओपन-सोर्स कोडिंग मॉडल्स वाला यूरोपीय
  संप्रभु (sovereign) क्लाउड प्रदाता।
icon: Server
searchHints:
  - evroc
  - eu
  - european
  - sovereign
  - kimi
  - mistral
  - llama
---

# Evroc

[Evroc](https://cloud.evroc.com) एक यूरोपीय संप्रभु क्लाउड प्रदाता है जो पूरे यूरोप में सुरक्षित और पर्यावरण-अनुकूल डेटा केंद्र संचालित करता है। अपने "Think" AI प्लेटफ़ॉर्म के माध्यम से, Evroc पूर्ण [GDPR](https://gdpr.eu) अनुपालन और यूरोपीय डेटा संप्रभुता के साथ Kimi, Llama और Mistral जैसे अग्रणी ओपन-सोर्स मॉडलों के लिए [OpenAI](https://openai.com)-संगत इन्फरेंस प्रदान करता है।

## सेटअप

1. [cloud.evroc.com](https://cloud.evroc.com) पर एक खाता बनाएँ।
2. Evroc Console में **Think > Models > + New** के तहत एक API कुंजी उत्पन्न करें।
3. बंडल किए गए साइडकार या टर्मिनल का उपयोग करके [OpenCode](https://opencode.ai) में कनेक्ट करें:
   ```bash
   opencode
   ```
   `/connect` टाइप करें, **evroc** चुनें, और अपनी API कुंजी दर्ज करें।
4. `/models` के साथ अपना सक्रिय मॉडल चुनें।

## अनुशंसित मॉडल्स

Evroc कोडिंग और तकनीकी तर्क (reasoning) के लिए अनुकूलित उच्च-क्षमता वाले ओपन वेट्स होस्ट करता है:

| Model                     | ID                                                                          | Creator                            | Strengths                                               |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :------------------------------------------------------ |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | असाधारण लॉन्ग-कॉन्टेक्स्ट कोडिंग और मल्टी-फ़ाइल रीजनिंग |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | तेज़, सटीक कोड जनरेशन और सत्यापन                        |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | व्यापक कोडिंग ज्ञान, प्रलेखन और रीफैक्टरिंग             |

> [!TIP]
> प्रोग्रामिंग कार्यों पर सर्वोत्तम परिणामों के लिए Evroc कंसोल में **Code** टैग वाले मॉडल्स देखें।

## Tendril के साथ उपयोग करना

आप Tendril v2 योजना निष्पादन को Evroc के माध्यम से दो तरीकों से रूट कर सकते हैं:

### विकल्प A: बंडल किए गए OpenCode के माध्यम से

1. Tendril डेस्कटॉप ऐप में, **Settings > Coding Agent** पर जाएँ।
2. अपने कोडिंग एजेंट के रूप में **OpenCode** चुनें (देखें [OpenCode Agent](../06_CodingAgents/04_OpenCode.md))।
3. Tendril बंडल किए गए [OpenCode](https://opencode.ai) साइडकार (`binaries/opencode`) को लागू करता है, जो आपके प्रमाणित Evroc प्रदाता के माध्यम से अनुरोधों को रूट करता है।

### विकल्प B: `config.yaml` में कस्टम OpenAI एंडपॉइंट

चूंकि Evroc एक OpenAI-संगत इंटरफ़ेस प्रदान करता है, आप इसे `~/.tendril/config.yaml` में सीधे `codingAgents` के तहत कॉन्फ़िगर कर सकते हैं (देखें [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-evroc-api-key"
      OPENAI_BASE_URL: "https://api.evroc.com/v1"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: balanced
        model: "moonshotai/Kimi-K2.5"
        effort: medium
      - name: quick
        model: "mistralai/Mistral-Small-24B-Instruct-2501"
        effort: low
```

## लिंक्स

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Evroc Cloud Console](https://cloud.evroc.com)
- [Evroc + OpenCode Documentation](https://docs.evroc.com/integrations/opencode.html)
