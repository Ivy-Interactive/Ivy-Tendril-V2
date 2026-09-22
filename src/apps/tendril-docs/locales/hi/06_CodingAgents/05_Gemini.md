---
title: जेमिनी सीएलआई (Gemini CLI)
description: Gemini CLI एक कोडिंग एजेंट है जो Google के Gemini मॉडल्स द्वारा संचालित है।
icon: Sparkles
searchHints:
  - जेमिनी
  - गूगल
  - कोडिंग एजेंट
---

# जेमिनी सीएलआई (Gemini CLI)

## कॉन्फ़िगरेशन (Configuration)

`config.yaml` में Gemini को अपने कोडिंग एजेंट के रूप में सेट करें:

```yaml
codingAgent: gemini
```

या इसे **Settings > Coding Agent** में चुनें।

`config.yaml` संरचना और सेटिंग्स के बारे में अधिक जानकारी के लिए, [सेटअप और सेटिंग्स](../03_Configuration/01_Setup.md) देखें।

## आवश्यकताएँ (Requirements)

- [Homebrew](https://brew.sh) या [MacPorts](https://www.macports.org) के माध्यम से `gemini` बाइनरी इंस्टॉल करें:
  ```bash
  brew install gemini-cli
  # or: sudo port install gemini-cli
  ```
- **प्रमाणीकरण (Authentication)**: ध्यान दें कि कोई `gemini auth` CLI सब-कमांड नहीं है। प्रमाणित करने के लिए:
  - पहली बार चलाने पर, `gemini` आपके ब्राउज़र में OAuth के माध्यम से **Sign in with Google** के लिए प्रॉम्प्ट करता है।
  - एक सक्रिय CLI सत्र में, पुनः प्रमाणित करने या खाते बदलने के लिए `/auth` स्लैश कमांड (या `/auth login`) का उपयोग करें।
  - हेडलेस या CI परिवेशों के लिए, `GEMINI_API_KEY` पर्यावरण चर (environment variable) सेट करें ([Google AI Studio](https://aistudio.google.com/apikey) के माध्यम से जनरेट किया गया)।

## प्रोफ़ाइल (Profiles)

Tendril, Gemini प्रोफ़ाइलों को निम्नलिखित डिफ़ॉल्ट पर मैप करता है:

| प्रोफ़ाइल (`Profile`) | मॉडल (`Model`)   | उपयोग का मामला (`Use Case`) |
| --------------------- | ---------------- | --------------------------- |
| `deep`                | gemini-3.8-flash | जटिल मल्टी-फ़ाइल परिवर्तन   |
| `balanced`            | gemini-3.8-flash | मानक योजना निष्पादन         |
| `quick`               | gemini-3.8-flash | सरल समाधान और छोटे संपादन   |

प्रोफ़ाइल का चयन [योजना के जटिलता स्तर](../02_Concepts/01_Plans.md) के आधार पर स्वचालित रूप से किया जाता है, या `config.yaml` में प्रति [प्रॉम्प्टवेयर](../02_Concepts/02_Promptwares.md) कॉन्फ़िगर किया जा सकता है। Gemini CLI रीज़निंग एफर्ट फ़्लैग्स का उपयोग नहीं करता है।

Tendril में Gemini के लिए डिफ़ॉल्ट मॉडल `gemini-3.8-flash` है।

## उपलब्ध मॉडल्स (Available Models)

Tendril में Gemini कैटलॉग में शामिल हैं:

- `gemini-3.8-flash` (डिफ़ॉल्ट): अगली पीढ़ी का तेज़ और अत्यधिक सक्षम रीज़निंग, 1M संदर्भ विंडो (context window)
- `gemini-3.7-flash`: तेज़ और सक्षम रीज़निंग, 1M संदर्भ विंडो (context window)
- `gemini-3.6-flash`: मल्टीमॉडल रीज़निंग, 1M संदर्भ विंडो (context window)
- `gemini-3.1-pro`: जटिल आर्किटेक्चर के लिए उन्नत रीज़निंग, 1M संदर्भ विंडो (context window)
- `gemini-3-pro-preview`: अगली पीढ़ी का रीज़निंग पूर्वावलोकन (preview)
- `gemini-3-flash-preview`: अगली पीढ़ी का तेज़ पूर्वावलोकन (preview)

`config.yaml` में मॉडल को ओवरराइड करें:

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## निष्पादन और फ़्लैग्स (Execution & Flags)

Tendril, Gemini CLI को निम्नलिखित के साथ लॉन्च करता है:

- गैर-इंटरैक्टिव मोड (Non-interactive mode): `--output-format stream-json --skip-trust --approval-mode <mode>` (जहाँ `FullAuto` द्वारा `yolo` पास किया जाता है, `AcceptEdits` द्वारा `auto_edit`, और `Plan` द्वारा `plan`), तथा सैंडबॉक्स मोड सक्षम होने पर `--sandbox`।
- इंटरैक्टिव एजेंट टर्मिनल (Interactive Agent terminal): `gemini --yolo --skip-trust -i "<prompt>"`.
