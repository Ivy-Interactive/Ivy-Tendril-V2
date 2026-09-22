---
title: Claude Code
description: Claude Code, Tendril में डिफ़ॉल्ट कोडिंग एजेंट है, जो Anthropic के
  Claude मॉडल द्वारा संचालित है।
icon: Bot
searchHints:
  - क्लॉड
  - क्लॉड कोड
  - एंथ्रोपिक
  - कोडिंग एजेंट
  - एआई एजेंट
---

# Claude Code

## कॉन्फ़िगरेशन

`config.yaml` में Claude Code को अपने कोडिंग एजेंट के रूप में सेट करें:

```yaml
codingAgent: claude
```

या इसे **Settings > Coding Agent** में चुनें।

`config.yaml` संरचना और सेटिंग्स के बारे में अधिक विवरण के लिए, [सेटअप और सेटिंग्स](../03_Configuration/01_Setup.md) देखें।

## आवश्यकताएँ

- [Claude Code](https://code.claude.com/docs) CLI इंस्टॉल होना चाहिए और आपके PATH पर `claude` के रूप में उपलब्ध होना चाहिए। नेटिव इंस्टॉलर या [Homebrew](https://brew.sh) cask का उपयोग करें:
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # or: brew install --cask claude-code
  ```
- Tendril का उपयोग करने से पहले `claude auth login` (या `claude login`) चलाकर प्रमाणित करें। Claude Code के लिए [Anthropic](https://www.anthropic.com) Pro, Max, Team, Enterprise, या [Console](https://console.anthropic.com) प्लान की आवश्यकता होती है (मुफ़्त claude.ai टीयर में CLI एक्सेस शामिल नहीं है)।
- हेडलेस वातावरण या वैकल्पिक बैकएंड के लिए, `ANTHROPIC_API_KEY` सेट करें, या [AWS Bedrock](https://aws.amazon.com/bedrock/) (`CLAUDE_CODE_USE_BEDROCK=1`) या [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) (`CLAUDE_CODE_USE_VERTEX=1`) कॉन्फ़िगर करें।

## प्रोफ़ाइल

Tendril प्रयास स्तरों को Claude मॉडल में मैप करता है:

| Profile    | Model  | Effort | Use Case                                     |
| ---------- | ------ | ------ | -------------------------------------------- |
| `deep`     | opus   | max    | जटिल मल्टी-फ़ाइल परिवर्तन, आर्किटेक्चर कार्य |
| `balanced` | sonnet | high   | मानक योजना निष्पादन, अधिकांश कार्य           |
| `quick`    | haiku  | low    | सरल सुधार, फ़ॉर्मेटिंग, छोटे संपादन          |

प्रोफ़ाइल [योजना के जटिलता स्तर](../02_Concepts/01_Plans.md) के आधार पर स्वचालित रूप से चुनी जाती है, या `config.yaml` में प्रत्येक [प्रॉम्प्टवेयर](../02_Concepts/02_Promptwares.md) के अनुसार कॉन्फ़िगर की जा सकती है।

## उपलब्ध मॉडल

| Model            | ID                 | Context Window | Pricing (input / output per MTok) |
| ---------------- | ------------------ | -------------- | --------------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M             | $10.00 / $50.00                   |
| Claude Opus 5    | `claude-opus-5`    | 1M             | $5.00 / $25.00                    |
| Claude Opus      | `opus`             | 1M             | $5.00 / $25.00                    |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M             | $2.00 / $10.00                    |
| Claude Sonnet    | `sonnet`           | 1M             | $2.00 / $10.00                    |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k           | $1.00 / $5.00                     |
| Claude Haiku     | `haiku`            | 200k           | $1.00 / $5.00                     |

`opus`, `sonnet`, और `haiku` Claude Code के उपनाम (aliases) हैं जो उस टीयर के लिए Anthropic के वर्तमान मॉडल को ट्रैक करते हैं, जबकि `claude-opus-5` (कैटलॉग डिफ़ॉल्ट) और `claude-fable-5-1` पिन की गई ID हैं।

Claude Sonnet का शुरुआती मूल्य $2.00 / $10.00 दिनांक 2026-08-31 तक लागू है; इसके बाद मानक मूल्य $3.00 / $15.00 लागू होगा।

## Tendril स्किल्स प्लगइन

आप आधिकारिक Tendril इंजीनियरिंग और डिबगिंग स्किल्स को Claude Code प्लगइन के रूप में इंस्टॉल कर सकते हैं:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

स्थानीय विकास और परीक्षण के दौरान, सीधे अपने चेकआउट से स्किल्स लोड करें:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

अधिक विवरण के लिए, [एजेंट स्किल्स](00_Skills.md) देखें।
