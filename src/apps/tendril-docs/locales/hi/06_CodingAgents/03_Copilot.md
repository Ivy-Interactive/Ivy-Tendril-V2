---
title: Copilot
description: Copilot एक वैकल्पिक कोडिंग एजेंट है जो GitHub के Copilot CLI द्वारा संचालित है।
icon: Bot
searchHints:
  - कोपायलट
  - गिटहब
  - कोडिंग एजेंट
---

# Copilot

## कॉन्फ़िगरेशन (Configuration)

`config.yaml` में Copilot को अपने कोडिंग एजेंट के रूप में सेट करें:

```yaml
codingAgent: copilot
```

या इसे **Settings > Coding Agent** में चुनें।

`config.yaml` संरचना और सेटिंग्स पर अधिक विवरण के लिए, [सेटअप और सेटिंग्स (Setup & Settings)](../03_Configuration/01_Setup.md) देखें।

## आवश्यकताएँ (Requirements)

- [GitHub Copilot CLI](https://github.com/features/copilot) आपके PATH पर `copilot` के रूप में उपलब्ध होना चाहिए। आधिकारिक स्क्रिप्ट या [Homebrew](https://brew.sh) cask का उपयोग करके इंस्टॉल करें:
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # or: brew install --cask copilot-cli
  ```
  यदि स्टैंडअलोन `copilot` बाइनरी नहीं मिलता है लेकिन [GitHub CLI](https://cli.github.com) (`gh`) स्थापित है, तो Tendril स्वचालित रूप से `gh copilot` का उपयोग करता है।
- एक सक्रिय [GitHub Copilot](https://github.com/features/copilot) सदस्यता आवश्यक है।
- **प्रमाणीकरण (Authentication)**: Copilot में `login` CLI कमांड नहीं है और यह `gh auth login` के साथ क्रेडेंशियल साझा नहीं करता है। साइन इन करने के लिए:
  1. अपने टर्मिनल में CLI लॉन्च करें: `copilot`
  2. प्रॉम्प्ट पर, स्लैश कमांड चलाएँ: `/login`
  3. हेडलेस या अनअटेंडेड CI वातावरण के लिए, `COPILOT_GITHUB_TOKEN` (या `GH_TOKEN`) पर्यावरण चर (environment variable) को `Copilot Requests` अनुमति वाले पर्सनल एक्सेस टोकन के साथ सेट करें।

## प्रोफ़ाइल (Profiles)

Tendril प्रयास स्तरों (effort levels) को Copilot पर मैप करता है:

| Profile    | Model   | Effort | Use Case                     |
| ---------- | ------- | ------ | ---------------------------- |
| `deep`     | gpt-5.4 | high   | Complex multi-file changes   |
| `balanced` | gpt-5.4 | medium | Standard plan execution      |
| `quick`    | gpt-5.4 | low    | Simple fixes and small edits |

प्रोफ़ाइल का चयन स्वचालित रूप से [प्लान के जटिलता स्तर (plan's complexity level)](../02_Concepts/01_Plans.md) के आधार पर किया जाता है, या `config.yaml` में प्रति [प्रॉम्प्टवेयर (promptware)](../02_Concepts/02_Promptwares.md) कॉन्फ़िगर किया जा सकता है।

Tendril में Copilot के लिए डिफ़ॉल्ट मॉडल `gpt-5.4` है।

### समर्थित मॉडल (Supported Models)

GitHub Copilot अपने रनटाइम के माध्यम से OpenAI और Anthropic दोनों मॉडलों का समर्थन करता है:

- **[OpenAI](https://openai.com) मॉडल्स**: `gpt-5.4` (डिफ़ॉल्ट), `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5-mini`, `gpt-4.1` (रीज़निंग प्रयास: `low`, `medium`, `high`, `xhigh`)।
- **[Anthropic Claude](https://code.claude.com/docs) मॉडल्स**: `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5` (रीज़निंग प्रयास: `low`, `medium`, `high`, `xhigh`, `max`)।

## GitHub Copilot के लिए Tendril Skills इंस्टॉल करना

Tendril [Visual Studio Code](https://code.visualstudio.com) में GitHub Copilot के लिए विशेष स्किल्स प्रदान करता है, जिसमें प्लान डिबगिंग, जॉब आर्टिफ़ैक्ट निरीक्षण, कोड समीक्षा और समस्या निवारण (issue triage) शामिल हैं।

### Skills CLI का उपयोग करना

अपने कार्यक्षेत्र (workspace) के लिए स्किल्स इंस्टॉल करें:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

या सभी कार्यक्षेत्रों में वैश्विक स्तर पर (globally) इंस्टॉल करें:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### `.agents/skills/` में मैन्युअल प्लेसमेंट

स्किल्स को सीधे `.agents/skills/`, `.github/skills/`, या `~/.copilot/skills/` निर्देशिका में भी रखा जा सकता है:

```bash
mkdir -p .agents/skills
cp -r /path/to/skills/* .agents/skills/
```

एक बार इंस्टॉल होने के बाद, स्किल्स GitHub Copilot Chat में `/skills` मेनू के तहत दिखाई देते हैं और उन्हें सीधे स्लैश कमांड के रूप में इनवोक किया जा सकता है (उदा. `/tendril-debug-plan`, `/tendril-review`)।

अधिक विवरण के लिए, [एजेंट स्किल्स (Agent Skills)](00_Skills.md) देखें।
