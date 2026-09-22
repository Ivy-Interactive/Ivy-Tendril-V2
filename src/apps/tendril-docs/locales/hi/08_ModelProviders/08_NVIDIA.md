---
title: NVIDIA
description: NVIDIA Build के माध्यम से कोडिंग कार्यों के लिए NVIDIA NIM अनुमान
  (inference) माइक्रोसर्विस और त्वरित ओपन मॉडल्स तक पहुँचें।
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

[NVIDIA Build](https://build.nvidia.com), [NVIDIA](https://www.nvidia.com) NIM (Inference Microservice) एंडपॉइंट्स तक पहुँच प्रदान करता है, जो [Meta के Llama](https://llama.meta.com), [DeepSeek](https://www.deepseek.com), [Mistral AI](https://mistral.ai), और [Qwen](https://github.com/QwenLM) सहित अग्रणी ओपन मॉडल्स के लिए एंटरप्राइज-अनुकूलित, GPU-त्वरित अनुमान (inference) प्रदान करता है।

## OpenCode के माध्यम से सेटअप

1. [build.nvidia.com](https://build.nvidia.com) पर एक API key (`nvapi-` से शुरू होने वाली) जनरेट करें।
2. टर्मिनल या Tendril के एम्बेडेड PTY का उपयोग करके [OpenCode](https://opencode.ai) में कनेक्ट करें:
   ```bash
   opencode
   ```
   `/connect` टाइप करें, **NVIDIA** चुनें, और अपनी API key पेस्ट करें।
3. `/models` का उपयोग करके अपने सक्रिय मॉडल को बदलें।

## अनुशंसित मॉडल्स

NVIDIA NIM शीर्ष कोडिंग मॉडल्स के लिए अनुकूलित बिल्ड होस्ट करता है:

| Model                      | NIM Identifier                    | Execution Tier   | Creator                              |
| :------------------------- | :-------------------------------- | :--------------- | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep             | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Reasoning) | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanced         | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Quick            | [Meta AI](https://llama.meta.com)    |

## Tendril के साथ उपयोग

### विकल्प A: बंडल किए गए OpenCode के माध्यम से

1. Tendril डेस्कटॉप एप्लिकेशन में, **Settings > Coding Agent** खोलें।
2. अपने सक्रिय कोडिंग एजेंट के रूप में **OpenCode** चुनें ([OpenCode Agent](../06_CodingAgents/04_OpenCode.md) देखें)।
3. Tendril आपके प्रमाणित NVIDIA NIM मॉडल्स का उपयोग करके बंडल किए गए [OpenCode](https://opencode.ai) साइडकार के माध्यम से योजनाओं (plans) को चलाता है।

### विकल्प B: `config.yaml` में डायरेक्ट NIM API

NVIDIA NIM `https://integrate.api.nvidia.com/v1` पर पूरी तरह से [OpenAI](https://openai.com)-संगत एंडपॉइंट्स प्रदान करता है। आप Tendril को `~/.tendril/config.yaml` में सीधे कनेक्ट करने के लिए कॉन्फ़िगर कर सकते हैं ([Configuration Setup](../03_Configuration/01_Setup.md) देखें):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "nvapi-..."
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1"
    profiles:
      - name: deep
        model: "meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "qwen/qwen2.5-coder-32b-instruct"
        effort: medium
      - name: quick
        model: "meta/llama-3.1-8b-instruct"
        effort: low
```

> [!TIP]
> NVIDIA NIM एंडपॉइंट्स टोकन स्ट्रीमिंग सक्षम के साथ मानक OpenAI Chat Completion स्कीमा का उपयोग करते हैं, जिससे वे Tendril के लाइव आउटपुट व्यूअर्स के साथ पूरी तरह से संगत हो जाते हैं।

## लिंक्स

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [NVIDIA Build Catalog](https://build.nvidia.com)
- [NVIDIA NIM Documentation](https://build.nvidia.com/spark/cli-coding-agent)
