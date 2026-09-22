---
title: एजेंट स्किल्स (Agent Skills)
description: Tendril एजेंट स्किल्स Visual Studio Code, Claude Code, Antigravity,
  Cursor, OpenAI Codex और Gemini CLI पर स्वायत्त AI कोडिंग एजेंटों के लिए
  इंजीनियरिंग, डिबगिंग और समीक्षा वर्कफ़्लो को पैकेज करते हैं।
icon: Sparkles
searchHints:
  - स्किल्स
  - एजेंट स्किल्स
  - प्लगइन्स
  - कोपायलट
  - क्लॉड
  - एंटीग्रेविटी
  - कर्सर
  - कोडेक्स
  - जेमिनी
---

# एजेंट स्किल्स (Agent Skills)

## अवलोकन

एजेंट स्किल्स ओपन एजेंट स्किल्स विनिर्देश (open agent skills specification) का पालन करते हैं। प्रत्येक स्किल संरचित निर्देश, संदर्भ चेकलिस्ट और ऑटोमेशन स्क्रिप्ट प्रदान करती है जो कोडिंग एजेंटों को जटिल कार्यों में मार्गदर्शन करती है:

- `tendril-debug-plan`: [प्लान लॉग्स](../02_Concepts/01_Plans.md), JSONL सत्रों, सत्यापन रनों और विफलता मोड (failure modes) का गहन विश्लेषण करता है।
- `tendril-debug-job`: [जॉब्स व्यू](../04_Apps/04_Jobs.md) में रॉ एजेंट निष्पादन आर्टिफैक्ट्स और [प्रॉम्प्टवेयर](../02_Concepts/02_Promptwares.md) लॉग्स का विश्लेषण करता है।
- `tendril-review`: कार्यान्वयन के बाद गहन कोड समीक्षा, परीक्षण अंतराल विश्लेषण (test gap analysis) और क्लीनअप जांच करता है।
- `tendrillable`: स्वायत्त एजेंट निष्पादन की तत्परता के लिए [GitHub](../07_Integrations/01_Github.md) समस्याओं को वर्गीकृत करता है।
- `tendril-release`: पैकेज अपडेट, वर्ज़निंग, पुल अनुरोधों (PRs) और परिनियोजन रिलीज (deployment releases) को स्वचालित करता है।
- `tendril-extension`: Ivy Tendril एक्सटेंशन को [VS Code](https://code.visualstudio.com) और Antigravity IDE में बनाता, परीक्षण करता, पैकेज करता और लिंक करता है।

## सार्वभौमिक स्थापना (Universal Installation)

सार्वभौमिक स्किल्स CLI का उपयोग करके किसी भी समर्थित एजेंट के लिए स्किल्स इंस्टॉल करें:

```bash
# Install all skills
npx skills add ivy-interactive/ivy-tendril-v2

# Install an individual skill
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## एजेंट एकीकरण

### Visual Studio Code ([GitHub Copilot](03_Copilot.md) और AI एक्सटेंशन)

[VS Code](https://code.visualstudio.com) में सीधे [GitHub Copilot](https://github.com/features/copilot) को लक्षित करते हुए स्किल्स इंस्टॉल करें:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

या सभी वर्कस्पेस में विश्व स्तर पर (globally) इंस्टॉल करें:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

स्किल्स `.agents/skills/` (या `~/.copilot/skills/`) में संग्रहीत होती हैं और `/skills` मेनू के अंतर्गत Copilot Chat में दिखाई देती हैं। आप कंपैनियन एक्सटेंशन को भी लक्षित कर सकते हैं:

- [Cline](https://github.com/cline/cline): `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev): `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code): `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

कंपैनियन गाइड के विवरण के लिए, [VS Code सेटअप](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md) देखें।

### [Claude Code](01_ClaudeCode.md)

[Claude Code](https://code.claude.com/docs) प्लगइन मार्केटप्लेस के माध्यम से इंस्टॉल करें:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

स्थानीय परीक्षण के लिए, अपने चेकआउट की ओर इंगित करते हुए Claude Code प्रारंभ करें:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

कंपैनियन गाइड के विवरण के लिए, [Claude Code सेटअप](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md) देखें।

### Google Antigravity

[Antigravity](https://antigravity.google) CLI (`agy`) का उपयोग करके इंस्टॉल करें:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

या स्थानीय चेकआउट से:

```bash
agy plugin install ./
```

कंपैनियन गाइड के विवरण के लिए, [Antigravity सेटअप](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md) देखें।

### [Cursor](https://cursor.com)

[Cursor](https://cursor.com) को लक्षित करते हुए इंस्टॉल करें:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

या स्किल्स को `.cursor/skills/` में रखें। कंपैनियन गाइड के विवरण के लिए, [Cursor सेटअप](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md) देखें।

### [OpenAI Codex](02_Codex.md)

मार्केटप्लेस जोड़ें और [Codex](https://chatgpt.com/codex) में प्लगइन इंस्टॉल करें:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

[Gemini CLI](https://github.com/google-gemini/gemini-cli) का उपयोग करके सीधे स्किल्स इंस्टॉल करें:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
