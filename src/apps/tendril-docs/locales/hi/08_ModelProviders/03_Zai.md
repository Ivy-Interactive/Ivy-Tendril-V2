---
title: Z.AI
description: Z.AI समर्पित कोडिंग योजना विकल्पों के साथ GLM अग्रणी (frontier)
  मॉडलों तक उच्च-थ्रूपुट पहुँच प्रदान करता है।
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - bigmodel
---

# Z.AI

[Z.AI](https://z.ai) ([Zhipu AI](https://open.bigmodel.cn) द्वारा विकसित) GLM मॉडल परिवार तक एंटरप्राइज पहुँच प्रदान करता है, जिसमें स्वायत्त प्रोग्रामिंग एजेंटों, [योजनाओं](../02_Concepts/01_Plans.md), और स्वचालित सॉफ्टवेयर विकास वर्कफ़्लो के लिए अनुकूलित विशेष कोडिंग योजनाएं शामिल हैं।

## सेटअप

1. [Z.AI API कंसोल](https://z.ai/manage-apikey/apikey-list) से एक API कुंजी प्राप्त करें।
2. टर्मिनल या Tendril के एम्बेडेड PTY के माध्यम से [OpenCode](https://opencode.ai) में प्रमाणित करें:
   ```bash
   opencode auth login
   ```
   **Z.AI** (या यदि आपने समर्पित कोडिंग योजना की सदस्यता ली है, तो **Z.AI Coding Plan**) चुनें, फिर संकेत मिलने पर अपनी API कुंजी पेस्ट करें।
3. OpenCode लॉन्च करें और उपलब्ध मॉडलों को ब्राउज़ करें:
   ```bash
   opencode
   ```
   अपना सक्रिय मॉडल बदलने के लिए `/models` टाइप करें।

## अनुशंसित मॉडल

| मॉडल                  | ID                         | प्रोफ़ाइल टियर | इसके लिए सर्वश्रेष्ठ                          |
| :-------------------- | :------------------------- | :------------- | :-------------------------------------------- |
| **GLM 4.7**           | `glm-4.7`                  | Deep           | जटिल कोड जनरेशन, आर्किटेक्चर योजना, डिबगिंग   |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced       | नई सुविधाएँ जोड़ना, रीफैक्टरिंग, कोड समीक्षा  |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick          | तेज़ लिंटिंग, यूनिट टेस्ट जनरेशन, कमिट सारांश |

## Tendril के साथ उपयोग

1. Tendril डेस्कटॉप एप्लिकेशन खोलें और **Settings > Coding Agent** पर जाएँ।
2. अपने सक्रिय कोडिंग एजेंट के रूप में **OpenCode** चुनें (देखें [OpenCode एजेंट](../06_CodingAgents/04_OpenCode.md))।
3. Tendril बंडल किए गए [OpenCode](https://opencode.ai) साइडकार (`binaries/opencode`) को निष्पादित करता है, जिससे एजेंट जॉब्स सीधे Z.AI के बैकएंड के माध्यम से रूट होते हैं।

आप `~/.tendril/config.yaml` में प्रत्येक निष्पादन टियर के लिए GLM मॉडल भी निर्दिष्ट कर सकते हैं (देखें [कॉन्फ़िगरेशन सेटअप](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: opencode

codingAgents:
  - name: opencode
    profiles:
      - name: deep
        model: "glm-4.7"
        effort: high
      - name: balanced
        model: "glm-4-plus"
        effort: medium
      - name: quick
        model: "glm-4-air"
        effort: low
```

> [!NOTE]
> Z.AI की कोडिंग योजना उच्च दर सीमाएं (rate limits) और समवर्ती अनुरोध स्लॉट प्रदान करती है जो विशेष रूप से निरंतर एजेंट निष्पादन और जटिल [योजना](../02_Concepts/01_Plans.md) निर्माण के लिए अनुकूलित हैं।

## लिंक्स

- [मॉडल प्रदाता](_Index.md)
- [कोडिंग एजेंट](../06_CodingAgents/_Index.md)
- [Z.AI प्लेटफ़ॉर्म](https://z.ai)
- [Z.AI कंसोल](https://z.ai/manage-apikey/apikey-list)
- [Z.AI + OpenCode दस्तावेज़ीकरण](https://docs.z.ai/scenario-example/develop-tools/opencode)
