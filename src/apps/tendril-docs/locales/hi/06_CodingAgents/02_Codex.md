---
title: Codex
description: Codex OpenAI के GPT मॉडलों द्वारा संचालित एक वैकल्पिक कोडिंग एजेंट
  (coding agent) है।
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - कोडिंग एजेंट
---

# Codex

## कॉन्फ़िगरेशन (Configuration)

`config.yaml` में Codex को अपने कोडिंग एजेंट के रूप में सेट करें:

```yaml
codingAgent: codex
```

या इसे **Settings > Coding Agent** में चुनें।

`config.yaml` संरचना और सेटिंग्स के बारे में अधिक विवरण के लिए, [सेटअप और सेटिंग्स](../03_Configuration/01_Setup.md) देखें।

## आवश्यकताएँ (Requirements)

- [Codex](https://chatgpt.com/codex) CLI इंस्टॉल होना चाहिए और आपके PATH पर `codex` के रूप में उपलब्ध होना चाहिए। आधिकारिक स्क्रिप्ट या [Homebrew](https://brew.sh) cask का उपयोग करके इंस्टॉल करें:
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # or: brew install --cask codex
  ```
- Tendril का उपयोग करने से पहले निम्न चलाकर प्रमाणीकरण (Authenticate) करें:
  ```bash
  codex login
  ```
  हेडलेस (headless) या अनअटेंडेड वातावरण के लिए, stdin के माध्यम से एक [OpenAI प्लेटफॉर्म API कुंजी](https://platform.openai.com/api-keys) पास करें:
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## प्रोफाइल्स (Profiles)

Tendril प्रयास स्तरों (effort levels) को Codex मॉडलों पर मैप करता है:

| Profile    | Model         | Effort | Use Case                             |
| ---------- | ------------- | ------ | ------------------------------------ |
| `deep`     | gpt-5.6-sol   | high   | जटिल बहु-फ़ाइल परिवर्तन              |
| `balanced` | gpt-5.6-terra | medium | मानक योजना निष्पादन (plan execution) |
| `quick`    | gpt-5.6-luna  | low    | सरल सुधार और छोटे संपादन             |

प्रोफ़ाइल का चयन [योजना के जटिलता स्तर](../02_Concepts/01_Plans.md) के आधार पर स्वचालित रूप से किया जाता है, या `config.yaml` में प्रति [promptware](../02_Concepts/02_Promptwares.md) कॉन्फ़िगर किया जा सकता है।

Tendril में Codex के लिए डिफ़ॉल्ट मॉडल `gpt-5.6-terra` है।

### समर्थित मॉडल और रीज़निंग प्रयास (Supported Models & Reasoning Effort)

Codex कैटलॉग निम्नलिखित [OpenAI](https://openai.com) मॉडलों का समर्थन करता है:

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra` (डिफ़ॉल्ट)
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

Codex पाँच रीज़निंग प्रयास स्तरों का समर्थन करता है: `none`, `low`, `medium`, `high`, और `xhigh`। `none` स्तर त्वरित संपादनों के लिए बिना किसी रीज़निंग ओवरहेड के Codex को चलाने की अनुमति देता है।

## निष्पादन और सैंडबॉक्सिंग (Execution & Sandboxing)

Tendril गैर-इंटरैक्टिव मोड में `codex exec` के माध्यम से Codex लॉन्च करता है:

- सैंडबॉक्सिंग नेटवर्क एक्सेस सक्षम होने के साथ डिफ़ॉल्ट रूप से `--sandbox workspace-write` पर सेट होती है। जब प्रोजेक्ट सुरक्षा सेटिंग्स में सैंडबॉक्स मोड अक्षम होता है, तो Tendril `danger-full-access` पास करता है।
- सुरक्षा नियमों से अतिरिक्त अनुमत पथ `--add-dir` के माध्यम से प्रदान किए जाते हैं।
- कॉन्फ़िगर किए गए [MCP (Model Context Protocol)](https://modelcontextprotocol.io) सर्वर एक अस्थायी JSON कॉन्फ़िगरेशन में लिखे जाते हैं और `--mcp-config` के माध्यम से प्रदान किए जाते हैं।
