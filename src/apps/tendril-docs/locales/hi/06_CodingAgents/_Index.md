---
title: कोडिंग एजेंट्स (Coding Agents)
description: कोडिंग एजेंट्स AI-संचालित रनटाइम हैं जो Tendril योजनाओं (plans) को
  निष्पादित करते हैं। एक एजेंट चुनें, प्रोफाइल कॉन्फ़िगर करें, एजेंट स्किल्स
  इंस्टॉल करें, और Tendril को कार्य व्यवस्थित करने दें।
icon: Bot
groupExpanded: true
searchHints:
  - कोडिंग एजेंट्स (coding agents)
  - एजेंट (agent)
  - क्लाउड (claude)
  - कोडेक्स (codex)
  - कोपायलट (copilot)
  - ओपनकोड (opencode)
  - जेमिनी (gemini)
  - स्किल्स (skills)
---

# कोडिंग एजेंट्स (Coding Agents)

कोडिंग एजेंट्स AI-संचालित रनटाइम हैं जो Tendril [योजनाओं (plans)](../02_Concepts/01_Plans.md) को निष्पादित करते हैं। एक एजेंट चुनें, प्रोफाइल कॉन्फ़िगर करें, एजेंट स्किल्स इंस्टॉल करें, और Tendril को कार्य व्यवस्थित करने दें।

- [एजेंट स्किल्स (Agent Skills)](00_Skills.md) — स्वायत्त AI कोडिंग एजेंट्स के लिए पैकेज इंजीनियरिंग, डिबगिंग और समीक्षा वर्कफ़्लो।
- [Claude Code](01_ClaudeCode.md) — Tendril में डिफ़ॉल्ट कोडिंग एजेंट, जो [Anthropic Claude](https://code.claude.com/docs) मॉडल्स द्वारा संचालित है।
- [Codex](02_Codex.md) — [OpenAI](https://openai.com) GPT मॉडल्स द्वारा संचालित वैकल्पिक कोडिंग एजेंट।
- [Copilot](03_Copilot.md) — GitHub के [Copilot CLI](https://github.com/features/copilot) द्वारा संचालित कोडिंग एजेंट।
- [OpenCode](04_OpenCode.md) — विभिन्न इंफ़्रेंस बैकएंड्स का समर्थन करने वाला मल्टी-प्रोवाइडर कोडिंग एजेंट।
- [Gemini CLI](05_Gemini.md) — Google [Gemini](https://ai.google.dev) मॉडल्स द्वारा संचालित कोडिंग एजेंट।

## पर्यावरण चर (Environment Variables)

आप `config.yaml` के माध्यम से कोडिंग एजेंट प्रोसेस में पर्यावरण चर (environment variables) इंजेक्ट कर सकते हैं। ये जॉब निष्पादन ([योजनाएं](../02_Concepts/01_Plans.md)) और इंटरैक्टिव Agent टैब (PTY) दोनों पर लागू होते हैं। पूर्ण कॉन्फ़िगरेशन विकल्पों के लिए, [सेटअप और सेटिंग्स](../03_Configuration/01_Setup.md) देखें।

```yaml
codingAgents:
  - name: claude
    environmentVariables:
      CLAUDE_CODE_USE_BEDROCK: "1"
      ANTHROPIC_BASE_URL: "https://your-endpoint.example.com"
    profiles:
      - name: balanced
        model: sonnet
        effort: high
```

`environmentVariables` के अंतर्गत कोई भी key/value जोड़े एजेंट के शुरू होने से पहले उसके प्रोसेस परिवेश में सेट किए जाते हैं। इसका उपयोग प्रोवाइडर कॉन्फ़िगरेशन (जैसे [AWS Bedrock](https://aws.amazon.com/bedrock/), कस्टम API एंडपॉइंट्स) या एजेंट CLI द्वारा समर्थित किसी भी रनटाइम फ़्लैग के लिए करें।
