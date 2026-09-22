---
title: प्रोजेक्ट
description: config.yaml में संग्रहीत प्रोजेक्ट्स को प्रबंधित करें। प्रोजेक्ट्स
  रिपॉजिटरीज़, सत्यापन (verifications), बिल्ड निर्भरताएँ (build dependencies),
  समीक्षा क्रियाएँ (review actions), MCP सर्वर्स और कस्टम स्किल्स का समूह बनाते
  हैं।
icon: FolderGit
searchHints:
  - प्रोजेक्ट
  - रेपो
  - सत्यापन
  - बिल्ड
  - निर्भरता
  - समीक्षा
  - क्रिया
  - mcp
  - स्किल्स
  - सिंक
  - हुक्स
---

# प्रोजेक्ट

`config.yaml` में संग्रहीत प्रोजेक्ट्स को प्रबंधित करें। प्रोजेक्ट्स [Git](https://git-scm.com) रिपॉजिटरीज़, [सत्यापन](03_Verification.md), बिल्ड निर्भरताओं, समीक्षा क्रियाओं, [Model Context Protocol (MCP)](https://modelcontextprotocol.io) सर्वर्स और कस्टम [एजेंट स्किल्स](../../06_CodingAgents/00_Skills.md) का समूह बनाते हैं। व्यापक UI वर्कफ़्लो के लिए, [प्रोजेक्ट कॉन्फ़िगरेशन](../../03_Configuration/02_Projects.md) देखें।

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — सभी कॉन्फ़िगर किए गए प्रोजेक्ट्स को सूचीबद्ध करता है, जिसमें रिपॉजिटरी और सत्यापन की संख्या प्रदर्शित होती है
- **get** — [YAML](https://yaml.org) प्रारूप में पूर्ण कॉन्फ़िगरेशन विवरण प्रदर्शित करता है, जिसमें रिपॉजिटरीज़, सत्यापन, समीक्षा क्रियाएँ, बिल्ड निर्भरताएँ, MCP सर्वर्स और कस्टम स्किल्स शामिल हैं
- **add** — `config.yaml` में एक नई प्रोजेक्ट प्रविष्टि बनाता है
- **rename** — किसी मौजूदा प्रोजेक्ट का नाम बदलता है और सभी आंतरिक संदर्भों को अपडेट करता है
- **remove** — `config.yaml` से प्रोजेक्ट कॉन्फ़िगरेशन को हटाता है
- **set** — एक स्केलर प्रोजेक्ट फ़ील्ड को अपडेट करता है। समर्थित फ़ील्ड्स: `color` (हेक्स रंग स्ट्रिंग), `context` (एजेंट्स के लिए मार्कडाउन प्रॉम्प्ट निर्देश), `stackHash`

## रिपॉजिटरीज़ और सिंक

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — प्रोजेक्ट के साथ एक स्थानीय रिपॉजिटरी चेकआउट पथ को संबद्ध करता है
- **remove-repo** — प्रोजेक्ट से किसी रिपॉजिटरी पथ का संबंध हटाता है
- **sync** — [Git](https://git-scm.com) का उपयोग करके रिमोट शाखाओं (remote branches) को खींचता है (pulls) और सभी प्रोजेक्ट रिपॉजिटरीज़ को फ़ास्ट-फ़ॉरवर्ड करता है। भिन्न (diverged) रिपॉजिटरीज़ डायग्नोस्टिक निवारण निर्देश रिपोर्ट करती हैं।

## सत्यापन (Verifications)

प्रोजेक्ट्स यह परिभाषित करते हैं कि किसी [योजना (plan)](01_Plan.md) के पूरा होने से पहले कौन से [सत्यापन परीक्षण](03_Verification.md) पास होने चाहिए:

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — इस प्रोजेक्ट से एक वैश्विक सत्यापन जाँच को लिंक करता है। डिफ़ॉल्ट रूप से आवश्यक है; इसे केवल सलाहकारी (advisory) चिह्नित करने के लिए `--optional` पास करें, या निष्पादन क्रम निर्दिष्ट करने के लिए `--after` पास करें।
- **remove-verification** — प्रोजेक्ट से सत्यापन गेट को हटाता है।
- **move-verification** — अन्य सत्यापनों के सापेक्ष रन ऑर्डर की स्थिति को समायोजित करता है (`--before`, `--after`, या शून्य-आधारित `--position`)।

## बिल्ड निर्भरताएँ (Build Dependencies)

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

बाहरी बाइनरी और टूल पूर्वापेक्षाओं (जैसे `cargo`, `dotnet`, `node`, [gh](https://cli.github.com)) को कॉन्फ़िगर करता है जिन्हें किसी योजना को निष्पादित करने से पहले सत्यापित किया जाता है।

## समीक्षा क्रियाएँ (Review Actions)

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

समीक्षा क्रियाएँ शेल कमांड हैं जो इंटरैक्टिव कोड समीक्षा के दौरान चलाई जाती हैं:

| Option             | Effect                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `--command <cmd>`  | इंटरैक्टिव टर्मिनल PTY के भीतर निष्पादित शेल कमांड लाइन                                          |
| `--condition <ex>` | क्रिया चलाने से पहले मूल्यांकित वैकल्पिक एक्सप्रेशन                                              |
| `--paths <prefix>` | रिपॉजिटरी-सापेक्ष पथ फ़िल्टर जो संशोधित होने पर इस क्रिया को ट्रिगर करता है (दोहराया जा सकता है) |
| `--before <name>`  | किसी मौजूदा क्रिया से पहले सम्मिलित करें                                                         |
| `--after <name>`   | किसी मौजूदा क्रिया के बाद सम्मिलित करें                                                          |

`tendril project review-actions` किसी योजना के वर्क-ट्री से प्राप्त बदली गई फ़ाइलों के विरुद्ध समीक्षा क्रियाओं का मूल्यांकन और रैंकिंग करता है।

## MCP सर्वर्स और कस्टम स्किल्स

प्रोजेक्ट्स प्रोजेक्ट-स्कोप्ड [MCP](https://modelcontextprotocol.io) सर्वर्स और कस्टम एजेंट स्किल्स को पंजीकृत कर सकते हैं:

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

किसी मौजूदा रिपॉजिटरी से सीधे MCP सर्वर्स या स्किल्स आयात करने के लिए:

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Promptware हुक्स

हुक्स [promptware](../../02_Concepts/02_Promptwares.md) के चलने से पहले या बाद में कस्टम शेल क्रियाओं को निष्पादित करते हैं:

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| Option                 | Effect                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `--when <timing>`      | टाइमिंग ट्रिगर: `before` (डिफ़ॉल्ट) या `after`                                                        |
| `--promptwares <list>` | ट्रिगर करने के लिए कॉमा से अलग किए गए promptwares (उदा. `ExecutePlan,CreatePr`), या छोड़े जाने पर सभी |
| `--action <cmd>`       | निष्पादित करने के लिए शेल कमांड                                                                       |
| `--condition <expr>`   | एक्सप्रेशन जिसका हुक के ट्रिगर होने के लिए true होना आवश्यक है                                        |

## पोर्ट्स और एनवायरनमेंट फ़ाइलें

प्लान वर्क-ट्रीज़ में प्रयुक्त नामित सर्विस पोर्ट्स और `.env` टेम्पलेट फ़ाइलों को प्रबंधित करें:

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
