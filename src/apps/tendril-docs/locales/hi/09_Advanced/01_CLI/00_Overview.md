---
title: CLI अवलोकन
description: सीधे अपने टर्मिनल से योजनाओं (plans), प्रोजेक्ट्स, डेटाबेस और
  एजेंट्स को प्रबंधित करें। tendril बाइनरी एक सर्वर डेमॉन और एक संपूर्ण CLI टूल
  दोनों के रूप में काम करता है।
icon: Terminal
searchHints:
  - सीएलआई
  - कमांड
  - टर्मिनल
  - टेंड्रिल
  - शेल
  - रीसेट
  - बग रिपोर्ट
  - रन
  - सर्व
  - डॉक्टर
  - वर्शन
  - कॉन्फ़िग
---

# CLI अवलोकन

सीधे अपने टर्मिनल से योजनाओं (plans), प्रोजेक्ट्स, डेटाबेस और एजेंट्स को प्रबंधित करें। `tendril` बाइनरी एक सर्वर डेमॉन और एक संपूर्ण CLI टूल दोनों के रूप में काम करता है।

Tendril CLI आपको UI को छुए बिना आपके वर्कफ़्लो पर पूरा नियंत्रण देता है:

- **Plans** — योजनाओं को बनाएं, सूचीबद्ध करें, अपडेट करें और उनका निरीक्षण करें; repos, worktrees, verifications और recommendations को प्रबंधित करें
- **Projects** — प्रोजेक्ट्स, उनके repos, बिल्ड निर्भरताओं (build dependencies), समीक्षा कार्रवाइयों (review actions), MCP सर्वर्स और कस्टम स्किल्स को कॉन्फ़िगर करें
- **Verifications** — पुन: प्रयोज्य सत्यापन जांचों (reusable verification checks) को परिभाषित और प्रबंधित करें
- **Config** — `config.yaml` में संग्रहीत शीर्ष-स्तरीय सेटिंग्स को पढ़ें और अपडेट करें
- **Vault** — टीम वॉल्ट्स को कनेक्ट करें, रिमोट repos खोजें, एसेट्स सिंक करें, और प्रोजेक्ट्स को इम्पोर्ट या पुश करें
- **Database** — माइग्रेशन चलाएं, स्कीमा वर्शन्स का निरीक्षण करें, तालिकाओं को रीसेट करें, अखंडता (integrity) की जांच करें और वैक्यूम करें
- **Agents & Jobs** — promptwares चलाएं, बैकग्राउंड जॉब्स प्रबंधित करें, और इंटरैक्टिव चैट सत्र संचालित करें

## त्वरित शुरुआत (Quick Start)

**1. अपने इंस्टॉलेशन की जांच करें**

```terminal
>tendril doctor
```

**2. डेमॉन सर्वर प्रारंभ करें**

```terminal
>tendril run
```

**3. एक नई योजना (plan) बनाएं**

```terminal
>tendril plan create "Fix login bug" MyProject
```

**4. सक्रिय योजनाओं की सूची देखें**

```terminal
>tendril plan list --state Executing
```

**5. सब कुछ रीसेट करें और नए सिरे से शुरुआत करें**

```terminal
>tendril reset
```

> [!TIP]
> प्रत्येक कमांड विस्तृत उपयोग के लिए `--help` का समर्थन करता है। उदाहरण के लिए: `tendril plan create --help`।

## ग्लोबल ऑप्शन्स (Global Options)

| Flag            | Effect                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `--home <path>` | Tendril होम डायरेक्टरी का पथ (इसे `TENDRIL_HOME` पर्यावरण चर (environment variable) के माध्यम से भी सेट किया जा सकता है) |

## पर्यावरण चर (Environment Variables)

| Variable        | Purpose                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME`  | कॉन्फ़िग, डेटाबेस, इनबॉक्स और योजनाओं के लिए रूट डायरेक्टरी (डिफ़ॉल्ट रूप से `~/.tendril` या `D:\.tendril`)                                                                         |
| `TENDRIL_PLANS` | योजना निर्देशिका (plans directory) को ओवरराइड करें (डिफ़ॉल्ट रूप से `TENDRIL_HOME/Plans`)                                                                                           |
| `RUST_LOG`      | stderr पर प्रक्रिया लॉगिंग के लिए फ़िल्टर निर्देश (डिफ़ॉल्ट: `warn,tendril_cli=info,tendril_core=info,tendril_server=info`)। विस्तृत डायग्नोस्टिक लॉग्स के लिए `debug` पर सेट करें। |

## सामान्य कमांड्स (Common Commands)

#### doctor

```terminal
>tendril doctor
>tendril doctor --rebuild-search-index
```

आपके Tendril इंस्टॉलेशन को सत्यापित करता है — `TENDRIL_HOME`, `config.yaml`, आवश्यक टूल्स (`git`, `gh`), डेटाबेस कनेक्टिविटी और एजेंट मॉडल की उपलब्धता की जांच करता है। डेटाबेस से पूर्ण-पाठ खोज सूचकांक (full-text search index) को पुनर्जीवित करने के लिए `--rebuild-search-index` का उपयोग करें।

#### plan doctor

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

प्रत्येक योजना फ़ोल्डर को स्कैन करता है और स्वास्थ्य रिपोर्ट प्रस्तुत करता है: अनुपलब्ध या विकृत `plan.yaml`, पुराने worktrees, और विफल सत्यापन के बावजूद `Completed` छोड़ी गई योजनाएं। पूर्ण विकल्प और स्वास्थ्य-कोड संदर्भ के लिए [Plan](01_Plan.md#doctor) देखें।

#### serve and run

```terminal
>tendril serve --port 5010 --host 127.0.0.1
>tendril serve --tls-cert /path/localhost.crt --tls-key /path/localhost.key
>tendril run
```

`tendril serve` HTTP और WebSocket API सर्वर प्रारंभ करता है (डिफ़ॉल्ट पोर्ट `5010`, होस्ट `127.0.0.1`)। वैकल्पिक `--tls-cert` और `--tls-key` फ़्लैग HTTPS की सुविधा प्रदान करते हैं।

`tendril run` सत्यापित करता है कि लक्षित पोर्ट उपलब्ध है, किसी भी लंबित डेटाबेस माइग्रेशन को स्वचालित रूप से लागू करता है, और फिर डेमॉन लॉन्च करता है।

#### reset

```terminal
>tendril reset
>tendril reset --force
```

मशीन से सभी Tendril डेटा को हटाता है — `TENDRIL_HOME` और `TENDRIL_PLANS` को हटा देता है। जब तक `--force` प्रदान नहीं किया जाता है, तब तक पुष्टि के लिए संकेत देता है।

> [!WARNING]
> यह लक्षित निर्देशिकाओं में मौजूद सभी योजनाओं, जॉब्स और कॉन्फ़िगरेशन डेटा को स्थायी रूप से हटा देता है।

#### report-bug

```terminal
>tendril report-bug --plan 00042
>tendril report-bug --job 00150 -d "Agent failed to create worktree"
>tendril report-bug --plan 00042 --out ~/Desktop/diagnostics.zip
>tendril report-bug --plan 00042 --submit --yes
```

योजना फ़ाइलों और प्रत्येक जॉब आर्टिफ़ैक्ट — Job Log, Job Prompt, Job Raw Log और Job Eventwire Log को `<TendrilHome>/Jobs/` से — सैनिटाइज़्ड कॉन्फ़िगरेशन और स्वास्थ्य निदान के साथ एक zip संग्रह में एकत्र करता है। जब `--submit` और `--yes` दिए जाते हैं, तो संग्रह को अपलोड करता है और एक GitHub समस्या (issue) खोलता है।

| Option                  | Effect                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `--plan <id>`           | इस योजना फ़ोल्डर और इसके विरुद्ध चलाए गए सभी जॉब्स को शामिल करें  |
| `--job <id>`            | इस जॉब के चार आर्टिफ़ैक्ट्स और इसके योजना के संदर्भ को शामिल करें |
| `-d, --description <t>` | बग विवरण (छोड़े जाने पर इंटरैक्टिव रूप से संकेत दिया जाता है)     |
| `--out <path>`          | zip संग्रह के लिए गंतव्य पथ                                       |
| `--github-user <name>`  | समस्या (issue) फ़ॉलो-अप के लिए GitHub उपयोगकर्ता नाम              |
| `--submit`              | GitHub पर रिपोर्ट अपलोड करें (`--yes` की आवश्यकता है)             |
| `-y, --yes`             | पुष्टि संकेत को छोड़ें                                            |

> [!WARNING]
> रिपोर्ट सबमिट करने से zip बंडल एक **सार्वजनिक (public)** GitHub समस्या (issue) से संलग्न हो जाता है। कॉन्फ़िग्स और जॉब लॉग्स से गोपनीय डेटा (secrets) हटा दिया जाता है, लेकिन सबमिट करने से पहले योजना सामग्री की समीक्षा अवश्य करें।

#### version

```terminal
>tendril version
```

स्थापित Tendril वर्शन को प्रिंट करता है (उदा. `tendril v2.0.0`)।

#### update-promptwares

```terminal
>tendril update-promptwares
>tendril update-promptwares --dry-run
>tendril update-promptwares --source /path/to/promptwares
```

`<TendrilHome>/Promptwares/` में तैनात promptwares को रिफ्रेश करता है, उनकी `Memory/` और `Tools/` निर्देशिकाओं को सुरक्षित रखता है।

## अगले कदम (Next Steps)

- [Plan कमांड्स](01_Plan.md) — योजनाओं को बनाने और प्रबंधित करने के लिए संपूर्ण संदर्भ
- [Project कमांड्स](02_Project.md) — प्रोजेक्ट्स, repos, समीक्षा कार्रवाइयों, MCP सर्वर्स और स्किल्स को कॉन्फ़िगर करें
- [Verification कमांड्स](03_Verification.md) — वैश्विक सत्यापन परिभाषाओं को प्रबंधित करें
- [Database कमांड्स](04_Database.md) — माइग्रेशन, स्कीमा वर्शन, अखंडता और वैक्यूम
- [अन्य कमांड्स](05_Other.md) — promptware, जॉब, चैट, सेवा और उपयोगिताएँ
- [Config कमांड्स](06_Config.md) — शीर्ष-स्तरीय `config.yaml` सेटिंग्स को पढ़ें और अपडेट करें
- [Vault कमांड्स](07_Vault.md) — टीम वॉल्ट्स कनेक्ट करें, एसेट्स सिंक करें, और प्रोजेक्ट्स को इम्पोर्ट या पब्लिश करें
