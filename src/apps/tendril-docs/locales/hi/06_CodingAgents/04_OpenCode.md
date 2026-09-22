---
title: OpenCode
description: OpenCode एक वैकल्पिक कोडिंग एजेंट है जो एकीकृत CLI के माध्यम से कई
  मॉडल प्रदाताओं का समर्थन करता है।
icon: Cpu
searchHints:
  - opencode
  - ओपन कोड
  - कोडिंग एजेंट
---

# OpenCode

## कॉन्फ़िगरेशन (Configuration)

`config.yaml` में OpenCode को अपने कोडिंग एजेंट के रूप में सेट करें:

```yaml
codingAgent: opencode
```

या इसे **Settings > Coding Agent** में चुनें।

`config.yaml` संरचना और सेटिंग्स पर अधिक विवरण के लिए, [सेटअप और सेटिंग्स](../03_Configuration/01_Setup.md) देखें।

## आवश्यकताएँ (Requirements)

- **बंडल किया गया साइडकार**: Tendril डेस्कटॉप ऐप के साथ बंडल किए गए साइडकार के रूप में [OpenCode](https://opencode.ai) प्रदान करता है और स्वचालित रूप से इसे PATH पर मौजूद किसी भी संस्करण की तुलना में प्राथमिकता देता है। नए सेटअप पर किसी मैन्युअल इंस्टॉलेशन की आवश्यकता नहीं है।
- **स्टैंडअलोन इंस्टॉलेशन** (वैकल्पिक): यदि आप स्टैंडअलोन कॉपी इंस्टॉल या चलाना चाहते हैं:
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **प्रमाणीकरण (Authentication)**: अपने चयनित प्रदाता (जैसे [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Groq](https://groq.com)) के साथ प्रमाणित करने के लिए `opencode providers login` (या `opencode auth login`) चलाएं।

## प्रोफ़ाइल (Profiles)

Tendril प्रयास स्तरों (effort levels) को OpenCode मॉडल में मैप करता है:

| Profile    | Model   | Effort | Use Case                 |
| ---------- | ------- | ------ | ------------------------ |
| `deep`     | default | high   | जटिल बहु-फ़ाइल परिवर्तन  |
| `balanced` | default | medium | मानक योजना निष्पादन      |
| `quick`    | default | low    | सरल सुधार और छोटे संपादन |

प्रयास स्तर सीधे OpenCode के `--variant` फ़्लैग (`low`, `medium`, `high`, `max`) पर मैप होते हैं।

डिफ़ॉल्ट कैटलॉग मॉडल `moonshotai/Kimi-K3` है। OpenCode पिन किए गए Anthropic और OpenAI मॉडल का भी समर्थन करता है जैसे कि `claude-fable-5-1`, `claude-opus-5`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-sonnet-4-6`, और `gpt-5.5`।

## अपना स्वयं का LLM और प्रदाता लाएँ (Bring-Your-Own LLM & Providers)

OpenCode **Settings > Coding Agent** में Tendril के **Bring-Your-Own LLM** कार्ड को शक्ति प्रदान करता है:

- **[OpenAI](https://openai.com)**: आपके `OPENAI_API_KEY` के साथ OpenCode को `https://api.openai.com` पर इंगित करता है।
- **[Anthropic](https://www.anthropic.com)**: आपके `ANTHROPIC_API_KEY` के साथ OpenCode को `https://api.anthropic.com/v1` पर इंगित करता है।
- **[Berget AI](../08_ModelProviders/01_Berget.md)**: आपके [Berget AI](https://berget.ai) API कुंजी के साथ OpenCode को `https://api.berget.ai/v1` पर इंगित करता है।
- **कस्टम एंडपॉइंट्स**: किसी भी OpenAI-संगत या Anthropic-संगत रिवर्स प्रॉक्सी के लिए कस्टम बेस URL और कुंजियाँ कॉन्फ़िगर करें। अधिक प्रदाताओं के लिए, [मॉडल प्रदाता](../08_ModelProviders/_Index.md) देखें।

Tendril `OPENCODE_CONFIG_CONTENT` का उपयोग करके इन प्रदाताओं को गैर-विनाशकारी (non-destructively) रूप से कॉन्फ़िगर करता है ताकि आपका वैश्विक `opencode.json` कॉन्फ़िगरेशन कभी ओवरराइट न हो।

## स्थानीय [Ollama](https://ollama.com) सेटअप

स्थानीय [Ollama](https://ollama.com) मॉडल के साथ OpenCode चलाते समय, सर्वर URL को सीधे `config.yaml` में निर्दिष्ट करें:

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
