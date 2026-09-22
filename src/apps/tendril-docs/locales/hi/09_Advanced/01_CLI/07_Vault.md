---
title: vault
description: टीम कॉन्फ़िगरेशन वॉल्ट प्रबंधित करें, GitHub पर साझा रिपॉजिटरी
  खोजें और कनेक्ट करें, कैटलॉग संपत्तियों का निरीक्षण करें, प्रोजेक्ट्स आयात
  करें, और सीधे CLI से कॉन्फ़िगरेशन अपडेट प्रकाशित करें।
icon: KeyRound
searchHints:
  - vault
  - sync
  - pull
  - import
  - push
  - कैटलॉग
  - खोजें
  - कनेक्ट करें
  - ऑटो-सिंक
  - टीम
---

# vault

[Git](https://git-scm.com) और [GitHub](https://github.com) द्वारा समर्थित टीम कॉन्फ़िगरेशन वॉल्ट प्रबंधित करें। वॉल्ट टीमों को वर्कस्टेशन पर प्रोजेक्ट कॉन्फ़िगरेशन, कस्टम स्किल्स, [Model Context Protocol (MCP)](https://modelcontextprotocol.io) सर्वर कॉन्फ़िगरेशन, प्रॉम्प्टवेयर मेमोरी और सत्यापन साझा करने की अनुमति देते हैं। CLI टीम रिपॉजिटरी खोजने, प्रोजेक्ट टेम्प्लेट आयात करने, और [GitHub Pull Requests](https://docs.github.com/en/pull-requests) के माध्यम से अपडेट सबमिट करने के लिए [GitHub CLI (`gh`)](https://cli.github.com) के साथ इंटरैक्ट करता है।

स्थानीय प्रोजेक्ट कॉन्फ़िगरेशन के लिए [प्रोजेक्ट्स](02_Project.md) और वैश्विक सेटिंग्स के लिए [ग्लोबल कॉन्फ़िगरेशन](06_Config.md) देखें।

## Commands

```terminal
>tendril vault list [--json]
>tendril vault status [vault-id] [--json]
>tendril vault discover [--json]
>tendril vault connect <repo-url> [--name <custom-name>]
>tendril vault create <repo-name> [--public] [--org <org>]
>tendril vault disconnect [vault-id] [-y, --yes]
>tendril vault sync [vault-id]
>tendril vault pull [vault-id]
>tendril vault set-auto-sync <enabled> [--vault <vault-id>]
>tendril vault catalog [vault-id] [--json]
>tendril vault import <project-name> [options]
>tendril vault push <projects...> [options]
>tendril vault delete <project-name> [--vault <vault-id>] [-y, --yes]
```

## वॉल्ट प्रबंधन

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

सभी कनेक्टेड वॉल्ट को सूचीबद्ध करता है, जिसमें उनका ID, नाम, रिमोट [Git](https://git-scm.com) रिपॉजिटरी URL, सक्रिय शाखा (branch), आगे/पीछे (ahead/behind) कमिट गणना, अंतिम सिंक टाइमस्टैम्प, और ऑटो-सिंक स्थिति प्रदर्शित होती है।

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

किसी विशिष्ट वॉल्ट या प्राथमिक कॉन्फ़िगर किए गए वॉल्ट के लिए विस्तृत डायग्नोस्टिक और सिंक्रोनाइज़ेशन स्थिति दिखाता है, जिसमें अनकमिटेड स्थानीय संशोधन और शाखा ट्रैकिंग स्थिति शामिल है।

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

आपके खाते और संगठनों के लिए सुलभ मौजूदा वॉल्ट रिपॉजिटरी खोजने के लिए [GitHub CLI (`gh`)](https://cli.github.com) का उपयोग करके [GitHub](https://github.com) को स्कैन करता है।

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

किसी मौजूदा [Git](https://git-scm.com) रिपॉजिटरी को टीम वॉल्ट के रूप में कनेक्ट करता है। पूर्ण रिपॉजिटरी URL या `org/repo` शॉर्टहैंड स्वीकार करता है।

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

[GitHub](https://github.com) पर एक नया रिपॉजिटरी बनाता है (डिफ़ॉल्ट रूप से निजी), मानक वॉल्ट डायरेक्टरी लेआउट को इनिशियलाइज़ करता है, और इसे स्थानीय रूप से कनेक्ट करता है। किसी संगठन को लक्षित करने के लिए `--org` और सार्वजनिक दृश्यता के लिए `--public` का उपयोग करें।

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

स्थानीय क्लोन डायरेक्टरी को हटाए बिना स्थानीय Tendril कॉन्फ़िगरेशन से वॉल्ट को डिस्कनेक्ट करता है। पुष्टिकरण प्रॉम्प्ट को छोड़ने के लिए `-y` या `--yes` पास करें।

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

रिमोट वॉल्ट रिपॉजिटरी से नवीनतम कॉन्फ़िगरेशन कमिट खींचता है और ट्रैक किए गए स्थानीय प्रोजेक्ट्स को अपडेट करता है। `pull`, `sync` के लिए एक उपनाम (alias) है।

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

किसी वॉल्ट के लिए स्वचालित सिंक्रोनाइज़ेशन को सक्षम या अक्षम करता है। `true`, `false`, `1`, `0`, `yes`, या `no` स्वीकार करता है।

## कैटलॉग और प्रोजेक्ट शेयरिंग

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

वॉल्ट कैटलॉग में प्रकाशित सभी प्रोजेक्ट्स और संपत्ति गणनाओं (रिपॉजिटरी, कस्टम स्किल्स, [Model Context Protocol (MCP)](https://modelcontextprotocol.io) सर्वर, प्रॉम्प्टवेयर मेमोरी, और सत्यापन) को सूचीबद्ध करता है।

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

वॉल्ट कैटलॉग से एक प्रोजेक्ट परिभाषा को स्थानीय Tendril कॉन्फ़िगरेशन में आयात करता है।

| विकल्प                 | विवरण                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| `--target-name <name>` | कैटलॉग नाम के स्थान पर पंजीकृत करने के लिए कस्टम स्थानीय प्रोजेक्ट नाम          |
| `--vault <vault-id>`   | आयात करने के लिए वॉल्ट ID या नाम (डिफ़ॉल्ट रूप से सक्रिय वॉल्ट)                 |
| `--repo <name=path>`   | वॉल्ट रिपॉजिटरी पहचानकर्ता को स्थानीय फाइलसिस्टम पथ पर मैप करें (दोहराने योग्य) |
| `--no-permissions`     | सुरक्षा नियमों और निष्पादन अनुमतियों को आयात करना छोड़ें                        |
| `--merge`              | किसी मौजूदा स्थानीय प्रोजेक्ट को बदलने के बजाय उसमें सेटिंग्स मर्ज करें         |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

प्रोजेक्ट कॉन्फ़िगरेशन, कस्टम स्किल्स, [Model Context Protocol (MCP)](https://modelcontextprotocol.io) कॉन्फ़िगरेशन, प्रॉम्प्टवेयर मेमोरी और सत्यापन एकत्र करता है, उन्हें एक फीचर शाखा में कमिट करता है, और वॉल्ट रिपॉजिटरी के विरुद्ध एक [GitHub Pull Request](https://docs.github.com/en/pull-requests) खोलता है।

| विकल्प                | विवरण                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--vault <vault-id>`  | लक्षित वॉल्ट पहचानकर्ता                                                                                                |
| `--version <version>` | कस्टम संस्करण स्ट्रिंग (डिफ़ॉल्ट रूप से UTC टाइमस्टैम्प)                                                               |
| `--changelog <text>`  | पुल रिक्वेस्ट विवरण में शामिल चेंजलॉग नोट्स                                                                            |
| `--title <title>`     | उत्पन्न पुल रिक्वेस्ट के लिए कस्टम शीर्षक                                                                              |
| `--body <body>`       | पुल रिक्वेस्ट के लिए कस्टम मुख्य विवरण                                                                                 |
| `--reviewer <names>`  | समीक्षकों के रूप में असाइन करने के लिए [GitHub](https://github.com) उपयोगकर्ता नाम (दोहराने योग्य या अल्पविराम से अलग) |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

वॉल्ट रिपॉजिटरी से एक प्रोजेक्ट को हटाता है और विलोपन लागू करने के लिए एक [GitHub Pull Request](https://docs.github.com/en/pull-requests) बनाता है। पुष्टि छोड़ने के लिए `-y` या `--yes` पास करें।

## उदाहरण

**टीम वॉल्ट को कनेक्ट और सिंक करें:**

```terminal
># Discover accessible team vaults on GitHub
>tendril vault discover

># Connect vault repository
>tendril vault connect https://github.com/my-org/shared-vault.git

># Pull updates
>tendril vault sync
```

**कैटलॉग से प्रोजेक्ट आयात करें:**

```terminal
># Inspect available catalog projects
>tendril vault catalog

># Import with custom local repository paths
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**पुल रिक्वेस्ट के माध्यम से प्रोजेक्ट अपडेट प्रकाशित करें:**

```terminal
># Push changes and open a pull request with assigned reviewers
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
