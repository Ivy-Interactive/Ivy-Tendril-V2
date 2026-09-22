---
title: सेटअप और सेटिंग्स
description: इन-ऐप सेटिंग्स UI में या TENDRIL_HOME/config.yaml को संपादित करके
  Tendril कॉन्फ़िगर करें (प्रोजेक्ट्स, एजेंट्स, लेवल्स, सत्यापन, प्राथमिकताएं)।
icon: Construction
searchHints:
  - कॉन्फ़िग
  - यामल
  - कॉन्फ़िगरेशन
  - सेटिंग्स
  - प्रोजेक्ट्स
  - जीयूआई
  - डिप्लॉयमेंट
  - डॉकर
  - सीक्रेट्स
  - बेसिकऑथ
  - पासवर्ड
  - होस्टेड
---

# सेटअप और सेटिंग्स

## इन-ऐप सेटिंग्स

Tendril में [YAML](https://yaml.org) को मैन्युअली संपादित किए बिना वातावरण को विज़ुअल रूप से कॉन्फ़िगर करने के लिए एक समर्पित सेटिंग्स ऐप शामिल है। सेटिंग्स साइडबार निम्नलिखित अनुभाग प्रदान करता है:

- **Coding Agent** — प्राथमिक कोडिंग एजेंट रनटाइम चुनें ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), Antigravity, [OpenCode](../06_CodingAgents/04_OpenCode.md), Cursor, Apple, या कस्टम OpenAI-संगत प्रॉक्सीज़), प्रदाता API कुंजियाँ और कस्टम बेस URLs कॉन्फ़िगर करें, एजेंट प्रोफ़ाइल और रीज़निंग टियर्स कस्टमाइज़ करें, एजेंट कनेक्टिविटी का परीक्षण करें, और Model Catalog के माध्यम से मॉडल विनिर्देशों को ब्राउज़ करें। एजेंट इंस्टॉलेशन और सेटअप के लिए, [Coding Agents](../06_CodingAgents/_Index.md) देखें।
- **Plans** — जब भी [Plans](../04_Apps/03_Plans.md) में कोई नया प्लान बनाया जाता है, तो उपयोग किए जाने वाले डिफ़ॉल्ट Markdown प्लान टेम्पलेट (`planTemplate`) को संपादित करें।
- **Appearance** — थीम मोड चुनें (**Light**, **Dark**, या **System**), पूर्वावलोकन स्वैच के साथ अंतर्निहित थीम प्रीसेट में से चुनें, डिफ़ॉल्ट साइडबार स्थिति (विस्तारित या संक्षिप्त) कॉन्फ़िगर करें, और Chat बटन लक्ष्य (**Chat view** या **Terminal**) चुनें।
- **Projects** — पंजीकृत प्रोजेक्ट्स प्रबंधित करें, प्रति-प्रोजेक्ट रिपॉजिटरी, सत्यापन, पोर्ट्स, पर्यावरण चर, कस्टम स्किल्स, [MCP](../09_Advanced/03_MCP.md) सर्वर कॉन्फ़िगर करें, और Danger Zone तक पहुँचें। [Project Setup](02_Projects.md) देखें।
- **Team Vault** _(बीटा)_ — साझा [Git](https://git-scm.com) रिपॉजिटरी के माध्यम से टीम के सदस्यों के बीच प्रोजेक्ट्स, कस्टम स्किल्स, MCP सर्वर और सुरक्षा नियमों को सिंक्रनाइज़ करें।
- **Workflow Agents** — मानक वर्कफ़्लोज़ (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, आदि) में या `_default` कुंजी का उपयोग करके विश्व स्तर पर [Promptware](../02_Concepts/02_Promptwares.md) एजेंट प्रोफ़ाइल और बारीक टूल अनुमतियां (`allowedTools`, `deniedTools`) कॉन्फ़िगर करें।
- **Levels** — सापेक्ष निष्पादन भार, विवरण और कस्टम बैज रंगों के साथ जटिलता स्तर (जैसे L1, L2, L3) परिभाषित करें।
- **Notifications** — जॉब पूर्ण होने और विफलताओं के लिए डेस्कटॉप सिस्टम सूचनाओं को चालू या बंद टॉगल करें।
- **Security & Tunneling** — वेब सत्र पासवर्ड सुरक्षा कॉन्फ़िगर करें, रिमोट एक्सेस के लिए पूर्ण-पहुँच [Cloudflare](https://www.cloudflare.com) टनल शुरू या बंद करें, और कैपेबिलिटी टोकन के साथ केवल-पढ़ने योग्य शेयर टनल बनाएं।
- **Advanced** — निष्पादन टाइमआउट सेट करें (`jobTimeout`, `staleOutputTimeout`), `maxConcurrentJobs` कॉन्फ़िगर करें, बीटा सुविधाओं की पहुँच को टॉगल करें, और लाइव **Daemon Diagnostics** (कनेक्शन स्थिति, PID, लेटेंसी पिंग, `$TENDRIL_HOME` पथ, और रिपोर्ट की गई क्षमताएं) का निरीक्षण करें।
- **Newsletter** — Ivy और Tendril उत्पाद अपडेट और रिलीज़ नोट्स की सदस्यता लें।
- **Open config.yaml** — लाइव सिंटैक्स हाइलाइटिंग और डायरेक्ट प्लान लिंकिंग के साथ अंतर्निहित रॉ YAML एडिटर लॉन्च करें।

## `config.yaml`

UI में संशोधित सेटिंग्स तुरंत `$TENDRIL_HOME/config.yaml` (डिफ़ॉल्ट रूप से `~/.tendril/config.yaml`) में सहेजी जाती हैं। आप इस फ़ाइल को सीधे भी संपादित कर सकते हैं या `TENDRIL_CONFIG` पर्यावरण चर का उपयोग करके एक कस्टम पथ निर्दिष्ट कर सकते हैं।

> [!NOTE]
> कॉन्फ़िगरेशन फ़ाइल का नाम हमेशा `config.yaml` होना चाहिए। डिस्क पर अपडेट होने पर Tendril डेमॉन कॉन्फ़िगरेशन परिवर्तनों को स्वचालित रूप से पुनः लोड करता है।

### उदाहरण

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Global Engine
    color: Emerald
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: CheckResult
        required: true

auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Managed via Settings
  hashSecret: "base64-secret-pepper"

api:
  apiKey: "your-api-secret-key"
```

### सामान्य फ़ील्ड्स

| फ़ील्ड                 | प्रकार        | डिफ़ॉल्ट    | उद्देश्य                                                                                            |
| ---------------------- | ------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `codingAgent`          | string        | `"claude"`  | डिफ़ॉल्ट कोडिंग एजेंट निष्पादन योग्य फ़ाइल। [Coding Agents](../06_CodingAgents/_Index.md) देखें।    |
| `maxConcurrentJobs`    | integer       | `20`        | समवर्ती एजेंट निष्पादन [Jobs](../04_Apps/04_Jobs.md) (worktrees) की अधिकतम संख्या।                  |
| `jobTimeout`           | integer (min) | `30`        | किसी सक्रिय कार्य के रद्द होने से पहले मिनटों में निष्पादन टाइमआउट।                                 |
| `staleOutputTimeout`   | integer (min) | `10`        | यदि कोई एजेंट प्रक्रिया कोई stdout/stderr आउटपुट उत्पन्न नहीं करती है तो मिनटों में टाइमआउट।        |
| `daemonRequestTimeout` | integer (sec) | `30`        | स्थानीय डेमॉन के साथ संचार करते समय सेकंड में क्लाइंट अनुरोध टाइमआउट।                               |
| `planTemplate`         | string        | `""`        | [Plans](../04_Apps/03_Plans.md) में नई योजनाएं बनाते समय उपयोग किया जाने वाला Markdown टेम्पलेट।    |
| `theme`                | string        | `"default"` | उपस्थिति प्रीसेट पहचानकर्ता (उदा. `default`, `dracula`)।                                            |
| `themeMode`            | string        | `"system"`  | थीम मोड: `light`, `dark`, या `system`।                                                              |
| `chatMode`             | string        | `"chat"`    | Chat बटन क्या खोलता है: `chat` (Chat दृश्य) या `terminal` (एजेंट टर्मिनल)।                          |
| `desktopNotifications` | boolean       | `true`      | क्या जॉब की घटनाओं के लिए डेस्कटॉप OS सूचनाएं सक्षम हैं।                                            |
| `projects`             | list          | `[]`        | पंजीकृत प्रोजेक्ट्स और उनके कॉन्फ़िगरेशन की सूची। [Project Setup](02_Projects.md) देखें।            |
| `levels`               | list          | standard    | कॉन्फ़िगर किए गए प्लान जटिलता स्तर और भार।                                                          |
| `auth`                 | object        | `null`      | [Argon2](https://en.wikipedia.org/wiki/Argon2) का उपयोग करके सत्र पासवर्ड सुरक्षा कॉन्फ़िगरेशन।     |
| `api.apiKey`           | string        | `null`      | REST API एंडपॉइंट्स की सुरक्षा करने वाला साझा सीक्रेट। [REST API](../09_Advanced/02_REST.md) देखें। |
| `telemetry`            | boolean       | `null`      | अज्ञात उपयोग टेलीमेट्री ऑप्ट-इन (`false` या अनुपस्थित होने का अर्थ बंद है)।                         |

## प्रमाणीकरण और रिमोट एक्सेस

### सत्र सुरक्षा (Web UI)

Tendril को किसी रिमोट सर्वर पर होस्ट करते समय या नेटवर्क पर एक्सपोज़ करते समय, **Settings > Security & Tunneling** में सत्र सुरक्षा सक्षम करें या पर्यावरण चर के माध्यम से क्रेडेंशियल कॉन्फ़िगर करें:

- `TENDRIL_AUTH_USERNAME` — लॉगिन उपयोगकर्ता नाम (डिफ़ॉल्ट: `admin`)।
- `TENDRIL_AUTH_PASSWORD` — स्टार्टअप पर हैश करने के लिए प्लेनटेक्स्ट पासवर्ड।
- `TENDRIL_AUTH_HASH_SECRET` — 32-बाइट base64 स्ट्रिंग ([OpenSSL](https://www.openssl.org) के माध्यम से `openssl rand -base64 32`) जिसका उपयोग [Argon2](https://en.wikipedia.org/wiki/Argon2) पेपर सीक्रेट के रूप में किया जाता है।

`config.yaml` में, पासवर्ड वैकल्पिक दर सीमा (rate limiting) के साथ `auth:` ब्लॉक के तहत Argon2 PHC हैश के रूप में संग्रहीत किए जाते हैं:

```yaml
auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..."
  hashSecret: "base64-encoded-pepper"
  rateLimit:
    threshold: 3
    baseDelaySeconds: 1.0
    maxDelaySeconds: 60.0
```

### Cloudflare टनल्स

Tendril आने वाले फ़ायरवॉल पोर्ट्स को खोले बिना एप्लिकेशन को सुरक्षित रूप से प्रदर्शित करने के लिए [Cloudflare](https://www.cloudflare.com) टनल्स (`cloudflared`) के साथ एकीकृत होता है:

- **Full-Access Tunnel**: संपूर्ण Tendril डेमॉन को प्रकाशित करता है। सुरक्षा के लिए, पूर्ण-पहुँच टनल शुरू करने से पहले Tendril लागू करता है कि कॉन्फ़िगर किए गए पासवर्ड के साथ सत्र सुरक्षा सक्रिय हो।
- **Share Tunnel**: कैपेबिलिटी टोकन द्वारा संरक्षित केवल-पढ़ने योग्य टनल बनाता है, जिससे राइट एक्सेस दिए बिना हितधारकों के साथ [Dashboard](../04_Apps/01_Dashboard.md) और प्लान की प्रगति को सुरक्षित रूप से साझा करने की अनुमति मिलती है।

### REST API सुरक्षा

REST API `config.yaml` में `api.apiKey` सेटिंग या `TENDRIL_API_KEY` पर्यावरण चर के माध्यम से टोकन प्रमाणीकरण का उपयोग करता है। सेट होने पर, अनुरोधों को `X-Api-Key` हेडर प्रदान करना होगा। [REST API](../09_Advanced/02_REST.md) और [CLI Configuration](../09_Advanced/01_CLI/06_Config.md) देखें।

## सत्यापन

Tendril अंतर्निहित सत्यापन गेट परिभाषाओं के साथ आता है जिन्हें प्रोजेक्ट अपनी पाइपलाइनों में जोड़ सकते हैं:

| सत्यापन       | विवरण                                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| `Build`       | प्रोजेक्ट बिल्ड कमांड चलाएं और शून्य कंपाइल त्रुटियों को सत्यापित करें।      |
| `Format`      | कोड फ़ॉर्मेटिंग नियमों को सत्यापित करें या बदली गई फ़ाइलों को फ़ॉर्मेट करें। |
| `Test`        | प्लान के परिवर्तनों के दायरे में यूनिट या इंटीग्रेशन परीक्षण चलाएं।          |
| `Lint`        | स्थिर विश्लेषण / लिंटर्स चलाएं और किसी भी उल्लंघन की रिपोर्ट करें।           |
| `Screenshots` | प्लान की आर्टिफ़ैक्ट्स डायरेक्टरी में UI स्क्रीनशॉट कैप्चर करें।             |
| `CheckResult` | सत्यापित करें कि अंतिम कार्यान्वयन योजना विनिर्देश से मेल खाता है।           |

कस्टम सत्यापन कमांड (जैसे `cargo test`, `pnpm test`, या `pytest`) विश्व स्तर पर `config.yaml` में या सीधे [Project Setup](02_Projects.md#verification-pipelines) के अंदर परिभाषित किए जा सकते हैं। CLI सत्यापन कमांड के लिए, [CLI Verification](../09_Advanced/01_CLI/03_Verification.md) देखें।
