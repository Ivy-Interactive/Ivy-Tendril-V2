---
title: Berget AI
description: यूरोपीय AI इंफ्रास्ट्रक्चर प्रदाता जो पूर्ण EU डेटा रेजीडेंसी और
  नेटिव Tendril v2 BYO कार्ड सपोर्ट के साथ Kimi और GLM मॉडल प्रदान करता है।
icon: Server
searchHints:
  - बर्गेट
  - ईयू
  - यूरोपीय
  - किमी
  - जीएलएम
  - मूनशॉट
---

# Berget AI

[Berget AI](https://berget.ai) एक यूरोपीय AI इंफ्रास्ट्रक्चर प्रदाता है जो स्वीडन में गारंटीकृत EU डेटा रेजीडेंसी के साथ संप्रभु (sovereign), उच्च-प्रदर्शन LLM इन्फेरेंस प्रदान करता है। Berget [OpenAI](https://openai.com)-संगत एंडपॉइंट्स प्रदान करता है जो फ्रंटियर ओपन-वेट मॉडल होस्ट करते हैं, जिसमें [Moonshot AI](https://moonshot.cn) का Kimi K3 और [Zhipu AI](https://open.bigmodel.cn) का GLM परिवार शामिल है, जो पूरी तरह से [GDPR](https://gdpr.eu) का अनुपालन करते हैं।

Tendril v2 में, Berget AI डेस्कटॉप एप्लिकेशन में एक नेटिव **Bring Your Own LLM** कार्ड के रूप में और बंडल किए गए [OpenCode](https://opencode.ai) साइडकार के माध्यम से दोनों तरह से समर्थित है।

## Tendril डेस्कटॉप के माध्यम से सेटअप

Berget AI का उपयोग करने का सबसे सरल तरीका डेस्कटॉप सेटिंग्स में नेटिव BYO कार्ड के माध्यम से है:

1. [console.berget.ai](https://console.berget.ai) पर एक खाता बनाएं और एक API कुंजी (API key) जनरेट करें।
2. Tendril खोलें और **Settings > Coding Agent** पर जाएं।
3. **Bring Your Own LLM** के तहत, **Berget AI** कार्ड पर क्लिक करें।
4. अपनी API कुंजी को **API Key** फ़ील्ड में पेस्ट करें और **Save** पर क्लिक करें।

> [!NOTE]
> UI में Berget के लिए कॉन्फ़िगर करने के लिए कोई बेस URL फ़ील्ड नहीं है। Tendril v2 स्वचालित रूप से एंडपॉइंट को `https://api.berget.ai/v1` पर पिन करता है और बंडल किए गए [OpenCode](../06_CodingAgents/04_OpenCode.md) साइडकार के माध्यम से अनुरोधों को रूट करता है।

## `config.yaml` में मैन्युअल कॉन्फ़िगरेशन

आप Berget AI को सीधे `~/.tendril/config.yaml` में भी कॉन्फ़िगर कर सकते हैं (देखें [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-berget-..."
      OPENAI_BASE_URL: "https://api.berget.ai/v1"
      ANTHROPIC_API_KEY: "sk-berget-..."
      ANTHROPIC_BASE_URL: "https://api.berget.ai"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: max
      - name: balanced
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: quick
        model: "moonshotai/Kimi-K3"
        effort: low
```

## अनुशंसित मॉडल

Tendril v2 का प्रोफ़ाइल रिज़ॉल्वर Berget AI को सभी स्तरों (tiers) में सीधे Kimi K3 से मैप करता है:

| स्तर (Tier)  | Model ID             | डिफ़ॉल्ट Effort | उद्देश्य                                            |
| :----------- | :------------------- | :-------------- | :-------------------------------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`           | आर्किटेक्चरल प्लानिंग, जटिल रीज़निंग, बड़े रिफैक्टर |
| **Balanced** | `moonshotai/Kimi-K3` | `high`          | मानक योजना निष्पादन और कोड जनरेशन                   |
| **Quick**    | `moonshotai/Kimi-K3` | `low`           | त्वरित सत्यापन, कमिट सारांश, स्थिति रिपोर्ट         |

Berget GLM परिवार के मॉडल (जैसे `GLM-4.7`) भी प्रदान करता है। आप अपने प्रोफ़ाइल कॉन्फ़िगरेशन में कोई भी उपलब्ध Berget मॉडल ID सेट कर सकते हैं या [OpenCode](../06_CodingAgents/04_OpenCode.md) में `/models` के साथ इसे चुन सकते हैं।

## OpenCode CLI के माध्यम से सेटअप

वैकल्पिक रूप से, आप OpenCode के माध्यम से Berget को कॉन्फ़िगर कर सकते हैं:

1. Berget सेटअप यूटिलिटी चलाएं:
   ```bash
   npx berget code init
   ```
2. OpenCode लॉन्च करें:
   ```bash
   opencode
   ```
3. Tendril में **Settings > Coding Agent** (`codingAgent: opencode`) के तहत अपने सक्रिय एजेंट को OpenCode पर सेट करें।

> [!TIP]
> Tendril v2 बंडल किए गए [OpenCode](https://opencode.ai) बाइनरी (`binaries/opencode`) के साथ आता है। Tendril के साथ Berget का उपयोग करने के लिए आपको अपने सिस्टम पर Node.js या OpenCode को विश्व स्तर (globally) पर इंस्टॉल करने की आवश्यकता नहीं है। [OpenCode Agent Guide](../06_CodingAgents/04_OpenCode.md) में और जानें।

## लिंक्स

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Berget AI Homepage](https://berget.ai)
- [Berget Console](https://console.berget.ai)
- [Berget + OpenCode Documentation](https://docs.berget.ai/integrations/opencode)
