---
title: config
description: सीधे कमांड लाइन से config.yaml में संग्रहीत शीर्ष-स्तरीय Tendril
  कॉन्फ़िगरेशन सेटिंग्स प्राप्त करें और सेट करें।
icon: Settings
searchHints:
  - config
  - कॉन्फ़िगरेशन
  - सेटिंग्स
  - jobTimeout
  - codingAgent
  - planTemplate
  - gitTimeout
  - daemonRequestTimeout
  - llm
---

# config

`config.yaml` के अंदर [YAML](https://yaml.org) प्रारूप में संग्रहीत शीर्ष-स्तरीय Tendril कॉन्फ़िगरेशन सेटिंग्स प्राप्त करें और सेट करें — वही वैश्विक मान जो डेस्कटॉप और वेब इंटरफेस में Settings के अंतर्गत प्रबंधित किए जाते हैं। परिवेश और निर्देशिका लेआउट के बारे में अधिक विवरण के लिए [सेटअप गाइड](../../03_Configuration/01_Setup.md) देखें।

## Commands

```terminal
>tendril config get <key>
>tendril config set <key> <value>
```

- **`get`** — बिना किसी सजावटी फ़ॉर्मेटिंग के मानक आउटपुट (standard output) में रॉ मान प्रिंट करता है, जिससे यह शेल स्क्रिप्टिंग और सीधे फ़ाइलों या अन्य टूल्स में पाइप करने के लिए आदर्श बन जाता है।
- **`set`** — मान को सत्यापित करता है और `config.yaml` में अपडेट करता है। कुंजियाँ (keys) केस-असंवेदनशील (case-insensitive) हैं।

## Primitive Keys

Tendril टाइप सत्यापन के साथ कई प्रिमिटिव कॉन्फ़िगरेशन कुंजियों को मॉडल करता है:

| Key                            | Type                                | Default            | Description                                                                                                                                    |
| ------------------------------ | ----------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `codingAgent`                  | string                              | `claude`           | डिफ़ॉल्ट कोडिंग एजेंट निष्पादन योग्य (executable) या उपनाम (alias) (उदा., `claude`, `aider`, `codestory`)।                                     |
| `jobTimeout`                   | integer (minutes)                   | `120`              | चल रहे प्लान जॉब के लिए अधिकतम निष्पादन टाइमआउट।                                                                                               |
| `staleOutputTimeout`           | integer (minutes)                   | `10`               | बिना आउटपुट वाले जॉब को स्टाल (stalled) चिह्नित करने से पहले निष्क्रियता की अवधि।                                                              |
| `gitTimeout`                   | integer (minutes)                   | `5`                | [Git](https://git-scm.com) परिचालनों के लिए कमांड टाइमआउट।                                                                                     |
| `daemonRequestTimeout`         | integer (seconds)                   | `30`               | स्थानीय Tendril डेमॉन को HTTP अनुरोधों के लिए सेकंड में टाइमआउट (`0` या नकारात्मक अक्षम करता है)।                                              |
| `maxConcurrentJobs`            | integer                             | `2`                | अनुमत समवर्ती (concurrent) निष्पादन नौकरियों की अधिकतम संख्या।                                                                                 |
| `planTemplate`                 | string                              | `""`               | नए प्लान बनाते समय पहले जोड़ा जाने वाला [Markdown](https://daringfireball.net/projects/markdown/) टेम्पलेट।                                    |
| `planFolder`                   | string (optional)                   | `None`             | कस्टम फ़ाइल सिस्टम निर्देशिका जहाँ प्लान मार्कडाउन फ़ाइलें संग्रहीत की जाती हैं। अनसेट करने के लिए `""` पास करें।                              |
| `promptwareOverlay`            | string (optional)                   | `None`             | कस्टम प्रॉम्प्टवेयर युक्त ओवरले निर्देशिका का पथ। अनसेट करने के लिए `""` पास करें।                                                             |
| `telemetry`                    | boolean (optional)                  | `None`             | ऑप्ट-इन अनाम टेलीमेट्री टॉगल (`true` या `false`)। साफ़ करने के लिए `""` पास करें।                                                              |
| `beta`                         | boolean                             | `false`            | प्रयोगात्मक पूर्वावलोकन सुविधाओं को सक्षम करता है (`true` या `false`)।                                                                         |
| `desktopNotifications`         | boolean                             | `true`             | प्लान स्थिति और एजेंट पूर्णता के लिए सिस्टम डेस्कटॉप सूचनाओं को सक्षम करता है (`true` या `false`)।                                             |
| `theme`                        | string                              | `default`          | UI रंग प्रीसेट ID (उदा., `default`, `dracula`)।                                                                                                |
| `worktreeReaperInterval`       | integer (minutes)                   | `60`               | स्वचालित [Git](https://git-scm.com) वर्क-ट्री रीपर पास की आवृत्ति (`0` या नकारात्मक अक्षम करता है)।                                            |
| `worktreeReaperGrace`          | integer (minutes)                   | `1440`             | किसी निष्क्रिय वर्क-ट्री को रीपिंग के लिए पात्र माने जाने से पहले मिनटों में निष्क्रिय ग्रेस अवधि।                                             |
| `worktreeBranchDeleteMode`     | string                              | `PreserveUnpushed` | वर्क-ट्री रीप पर शाखा विलोपन सुरक्षा मोड (`PreserveUnpushed` या `Force`)।                                                                      |
| `coAuthor`                     | string (optional)                   | `None`             | स्वचालित कमिट्स में जोड़ा गया `Name <email>` प्रारूप में [Git](https://git-scm.com) ट्रेलर एट्रिब्यूशन पहचान। अनसेट करने के लिए `""` पास करें। |
| `enrichModels`                 | boolean                             | `true`             | स्वचालित पृष्ठभूमि मॉडल खोज और संवर्धन सक्षम करता है (`true` या `false`)।                                                                      |
| `modelEnrichmentIntervalHours` | integer (hours)                     | `24`               | मॉडल मेटाडेटा के लिए पृष्ठभूमि रीफ़्रेश अंतराल।                                                                                                |
| `modelCacheWarnAgeDays`        | integer (days)                      | `7`                | बासी मॉडल कैश द्वारा चेतावनियाँ उत्पन्न करने से पहले सॉफ़्ट आयु सीमा।                                                                          |
| `modelCacheMaxAgeDays`         | integer (days)                      | `30`               | हार्ड आयु सीमा जिसके बाद कैश्ड मॉडल मेटाडेटा समाप्त हो जाता है।                                                                                |
| `llm`                          | [JSON](https://www.json.org) object | `None`             | सहायक LLM सेवा के लिए एंडपॉइंट, API कुंजी, और मॉडल कॉन्फ़िगरेशन। मौजूदा फ़ील्ड्स के साथ मर्ज किया गया।                                         |

> [!NOTE]
> गैर-मॉडल किए गए अदिश कुंजियों (scalar keys) को भी संग्रहीत और पुनर्प्राप्त किया जा सकता है; वे `config.yaml` में एक अतिरिक्त विशेषता तालिका में संग्रहीत होते हैं।

## Structured Keys

Tendril सेटिंग्स में संरचित सूचियाँ और मानचित्र भी शामिल हैं जिन्हें `tendril config` के माध्यम से सेट या पुनर्प्राप्त नहीं किया जा सकता है:

- `projects` — कॉन्फ़िगर की गई प्रोजेक्ट परिभाषाएँ ([`tendril project`](02_Project.md) का उपयोग करके प्रबंधित करें)।
- `verifications` — वैश्विक सत्यापन सुइट परिभाषाएँ ([`tendril verification`](03_Verification.md) का उपयोग करके प्रबंधित करें)।
- `levels` — प्लान जटिलता स्तर और सत्यापन बाइंडिंग।
- `onboarding` — प्रथम-रन विज़ार्ड पूर्णता स्थितियाँ।
- `codingAgents` — प्रति-एजेंट बाइनरी पथ, तर्क, परिवेश चर, और प्रोफ़ाइल।
- `promptwares` — प्रति-प्रॉम्प्टवेयर निर्देश, प्रोफ़ाइल, और टूल नियम।
- `inbox` — इनबाउंड अधिसूचना नियम और वितरण एकीकरण।

किसी भी संरचित कुंजी पर `tendril config get` या `tendril config set` चलाने का प्रयास करने पर एक त्रुटि प्रिंट होती है जो आपको समर्पित CLI कमांड का उपयोग करने या सीधे `config.yaml` को संपादित करने के लिए निर्देशित करती है।

## Examples

```terminal
># Read a configuration value
>tendril config get jobTimeout

># Update a numeric or text setting
>tendril config set jobTimeout 60
>tendril config set codingAgent claude

># Toggle boolean options
>tendril config set desktopNotifications false
>tendril config set beta true

># Merge auxiliary LLM configuration
>tendril config set llm '{"model":"gpt-4o"}'

># Clear an optional setting by passing an empty string
>tendril config set coAuthor ""
>tendril config set planFolder ""

># Set a multiline plan template using shell command substitution
>tendril config set planTemplate "$(cat template.md)"

># Round-trip the plan template back out to a file
>tendril config get planTemplate > template.md
```

> [!TIP]
> `planTemplate` जैसे बहु-पंक्ति पाठ या `llm` जैसे [JSON](https://www.json.org) ऑब्जेक्ट निर्दिष्ट करते समय, यह सुनिश्चित करने के लिए कि मान एकल तर्क के रूप में साफ़ रूप से पास हों, शेल कोटिंग या कमांड प्रतिस्थापन (`"$(cat file.md)"`) का उपयोग करें।
