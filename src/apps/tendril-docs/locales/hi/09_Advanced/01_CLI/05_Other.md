---
title: अन्य कमांड्स
description: प्रॉम्प्टवेयर निष्पादन, बैकग्राउंड जॉब ऑर्केस्ट्रेशन, चैट सत्र,
  बैकग्राउंड सर्विस पंजीकरण, और उपयोगिताएँ।
icon: Wrench
searchHints:
  - प्रॉम्प्टवेयर
  - मेमोरी
  - टूल
  - जॉब
  - चैट
  - सर्विस
  - ऑटोस्टार्ट
  - लॉन्चडी
  - सिस्टमडी
  - स्थिति
  - मॉडल्स
  - हैश-पासवर्ड
  - जनरेट-सर्ट्स
  - एजेंट-निर्देश
---

# अन्य कमांड्स

प्रॉम्प्टवेयर निष्पादन, बैकग्राउंड जॉब ट्रैकिंग, इंटरैक्टिव चैट सत्र, OS बैकग्राउंड सर्विस प्रबंधन, और Tendril CLI उपयोगिता कमांड्स के लिए संदर्भ।

## promptware

Tendril एजेंट निष्पादन वर्कफ़्लो को संरचित करने के लिए [प्रॉम्प्टवेयर्स](../../02_Concepts/02_Promptwares.md) का उपयोग करता है। पृष्ठभूमि विवरण के लिए, [प्रॉम्प्टवेयर्स अवधारणा](../../02_Concepts/02_Promptwares.md) देखें।

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

सर्वर जॉब कतार को बायपास करते हुए, होस्ट मशीन पर सीधे एक प्रॉम्प्टवेयर चलाता है।

| Option                 | Effect                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| `--profile <profile>`  | Override the agent reasoning profile (`deep`, `balanced`, `quick`)                |
| `--working-dir <path>` | Working directory for the agent execution process                                 |
| `--value <key=value>`  | Additional firmware header values (repeatable)                                    |
| `--plan <id>`          | Target plan ID or folder path                                                     |
| `--agent <provider>`   | Override agent provider (`claude`, `antigravity`, `codex`, `copilot`, `opencode`) |
| `--dry-run`            | Print the compiled firmware to stdout and exit without launching an agent         |

#### Memory and Tools

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

एजेंट प्रॉम्प्टवेयर की `Memory/` डायरेक्टरी में सीखे गए पैटर्न को बनाए रखने और `Tools/` में कस्टम टूल लिखने के लिए इन कमांड्स का उपयोग करते हैं।

#### Deployment & Layers

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — मानक प्रॉम्प्टवेयर्स को संकलित करता है और `<TendrilHome>/Promptwares/` में स्थापित करता है।
- **layers** — यह जांचता है कि प्रत्येक प्रॉम्प्टवेयर फ़ाइल किस लेयर (shipped default या team overlay) द्वारा प्रदान की गई थी।

## job

एसिंक्रोनस बैकग्राउंड एजेंट जॉब्स प्रबंधित करें। जॉब्स डेमन कतार के माध्यम से चलते हैं और लाइव स्थिति की रिपोर्ट करते हैं। UI निरीक्षण के लिए, [जॉब्स ऐप](../../04_Apps/04_Jobs.md) देखें।

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

Tendril डेमन सर्वर से हाल के बैकग्राउंड जॉब्स को सूचीबद्ध करता है।

| Option              | Effect                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `--status <status>` | Filter by status (`Pending`, `Queued`, `Running`, `Completed`, `Failed`, `Timeout`, `Stopped`, `Blocked`) |
| `--limit <n>`       | Maximum number of results (default: 20)                                                                   |
| `--json`            | Output jobs as structured JSON                                                                            |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

चल रहे Tendril डेमन पर एक एसिंक्रोनस बैकग्राउंड जॉब शुरू करता है। समर्थित जॉब प्रकार: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`।

| Option                    | Effect                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `--priority <number>`     | Priority ranking for queue dispatch (higher runs first)                              |
| `--chat-session <id>`     | Associate job with a chat session (defaults to `$TENDRIL_CHAT_SESSION_ID`)           |
| `--wait-for <job-id>`     | Job ID that must complete before this job can be queued (repeatable)                 |
| `--idempotency-key <key>` | Idempotency token: resubmissions return the existing job instead of creating another |
| `--force`                 | Resubmit even if identical work is already in flight                                 |
| `--description <text>`    | Task description (used with `CreatePlan`)                                            |
| `--project <name>`        | Target project (used with `CreatePlan`)                                              |
| `--note <text>`           | Execution note (used with `ExecutePlan`)                                             |
| `--instructions <text>`   | Refinement prompt (used with `UpdatePlan`)                                           |
| `--change-request <text>` | Reviewer feedback (used with `RetryPlan`)                                            |
| `--repo <name>`           | Repository (used with `CreateIssue`)                                                 |
| `--assignee <user>`       | Assignee username on GitHub (used with `CreateIssue` / `CreatePr`)                   |
| `--reviewer <user>`       | Reviewer username on GitHub (used with `CreatePr`, repeatable)                       |
| `--draft`                 | Create as a draft PR (used with `CreatePr`)                                          |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status and fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

प्रगति टेलीमेट्री या जॉब विफलता की सीधे डेमन को रिपोर्ट करता है। निष्पादन के दौरान प्रॉम्प्टवेयर स्क्रिप्ट द्वारा आंतरिक रूप से उपयोग किया जाता है।

#### job cancel and delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — चल रहे जॉब को निरस्त करने का संकेत देता है।
- **delete** — डेटाबेस से एक जॉब रिकॉर्ड हटाता है (डिस्क पर लॉग फ़ाइलें सुरक्षित रहती हैं)।

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

`<TendrilHome>/Jobs/` में सीधे जॉब की लॉग फ़ाइल में एक `## Agent Log` विवरण प्रविष्टि जोड़ता है। सीधे फ़ाइल सिस्टम पर कार्य करता है और सर्वर डेमन तक पहुंच योग्य होने की आवश्यकता नहीं होती है।

#### Queue and Maintenance

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — प्रेषण क्रम में लंबित जॉब्स को प्रिंट करता है
- **force-start** — किसी जॉब को तुरंत प्रेषित करने के लिए समवर्तीता और निर्भरता प्रतिबंधों को बायपास करता है
- **stop-all** — प्रत्येक सक्रिय और कतारबद्ध जॉब को रद्द करता है
- **clear** — पूर्ण या विफल जॉब्स को बल्क में हटाता है
- **maintenance** — तुरंत एक जॉब सफाई और समाधान पास चलाता है

## chat

अपने टर्मिनल से इंटरैक्टिव एजेंट कोडिंग सत्र चलाएं:

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

`tendril chat send` डेमन से कनेक्ट होता है, प्रॉम्प्ट टर्न प्रेषित करता है, और रीयल-टाइम टोकन प्रतिक्रियाओं और टूल-कॉल घटनाओं को सीधे stdout पर स्ट्रीम करता है।

## service

विभिन्न प्लेटफ़ॉर्मों पर Tendril बैकग्राउंड डेमन ऑटोस्टार्ट सेवा को प्रबंधित करें:

- **macOS** — `~/Library/LaunchAgents/io.tendril.daemon.plist` पर एक [launchd](https://en.wikipedia.org/wiki/Launchd) एजेंट पंजीकृत करता है
- **Linux** — एक [systemd](https://systemd.io) उपयोगकर्ता सेवा इकाई पंजीकृत करता है
- **Windows** — [Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page) के साथ एक निर्धारित कार्य पंजीकृत करता है

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — चल रहे निष्पादन योग्य को बैकग्राउंड सर्विस के रूप में पंजीकृत करता है। तुरंत शुरू किए बिना अगले लॉगिन के लिए पंजीकृत करने हेतु `--no-start` का उपयोग करें।
- **status** — रिपोर्ट करता है कि क्या सेवा पंजीकृत, लोड और सेवारत है (URL और PID सहित)।
- **uninstall** — ऑटोस्टार्ट कॉन्फ़िगरेशन को अपंजीकृत करता है। `<home>/bin` में स्थापित साइडकार्स को हटाने के लिए `--purge-binaries` का उपयोग करें।

## Utilities

#### models

```terminal
>tendril models
>tendril models --refresh
```

समर्थित LLM मॉडल्स, प्रदाता संबद्धता, संदर्भ विंडो सीमाएँ, और लाइव मूल्य निर्धारण को सूचीबद्ध करता है। मॉडल रजिस्ट्री से अद्यतन दरों को प्राप्त करने के लिए `--refresh` का उपयोग करें।

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

`tendril serve --tls-cert <path> --tls-key <path>` के साथ HTTPS परोसने के लिए एक स्व-हस्ताक्षरित `localhost.crt` और `localhost.key` PEM युग्म उत्पन्न करता है।

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

`config.yaml` के `auth:` अनुभाग में उपयोग के लिए [Argon2](https://en.wikipedia.org/wiki/Argon2) के साथ एक पासवर्ड को हैश करता है। एन्कोडेड हैश स्ट्रिंग और पेपर सीक्रेट को प्रिंट करता है।

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

एक डायरेक्टरी का निरीक्षण करता है और भाषा रनटाइम, पैकेज मैनेजर और टेस्ट फ़्रेमवर्क की पहचान करने वाला एक संक्षिप्त YAML स्टैक विश्लेषण प्रिंट करता है।

#### agent-instructions

```terminal
>tendril agent-instructions
```

स्थापना पथों को प्रतिस्थापित करके संपूर्ण एजेंट सिस्टम प्रॉम्प्ट टेम्पलेट को संकलित और प्रिंट करता है, जिसे एक स्वायत्त एजेंट प्रॉम्प्ट में पाइप करने के लिए स्वरूपित किया गया है।

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

प्लान लेखन के दौरान डिज़ाइन किए गए React वायरफ्रेम को मचान (scaffold) तैयार करता है, परोसता है, हॉट रीलोड के साथ पूर्वावलोकन करता है, और स्क्रीनशॉट लेता है।
