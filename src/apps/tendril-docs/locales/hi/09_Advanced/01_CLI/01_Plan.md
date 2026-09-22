---
title: योजना
description: टर्मिनल से योजनाएं बनाएं, पढ़ें, अपडेट करें और मान्य करें। जब
  पर्यावरण चर (environment variables) सेट नहीं होते हैं, तो सभी सब-कमांड
  TENDRIL_PLANS, TENDRIL_HOME/Plans, या ~/.tendril/Plans से योजना फ़ोल्डर का
  समाधान करते हैं।
icon: ListChecks
searchHints:
  - योजना
  - बनाएं
  - सूची
  - प्राप्त करें
  - सेट करें
  - अपडेट करें
  - मान्य करें
  - रेपो
  - पीआर
  - कमिट
  - सत्यापन
  - अनुशंसा
  - रेक
  - लॉग
  - संशोधन
  - डॉक्टर
  - निर्भर करता है
  - संबंधित
  - पर्यावरण
  - वायरफ्रेम
---

# योजना

टर्मिनल से योजनाएं बनाएं, पढ़ें, अपडेट करें और मान्य करें। जब पर्यावरण चर (environment variables) सेट नहीं होते हैं, तो सभी सब-कमांड `TENDRIL_PLANS`, `TENDRIL_HOME/Plans`, या `~/.tendril/Plans` से योजना फ़ोल्डर का समाधान करते हैं।

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

`Draft` स्थिति के साथ एक नया योजना फ़ोल्डर और `plan.yaml` स्कैफ़ोल्ड बनाता है। योजना ID `.counter` फ़ाइल से स्वतः आवंटित होती है। रिपॉजिटरी और डिफ़ॉल्ट सत्यापन प्रोजेक्ट कॉन्फ़िगरेशन से प्राप्त किए जाते हैं।

| Option                          | Description                                             |
| ------------------------------- | ------------------------------------------------------- |
| `--level <level>`               | प्राथमिकता स्तर (डिफ़ॉल्ट: Feature)                     |
| `--initial-prompt <text>`       | प्रारंभिक प्रॉम्प्ट टेक्स्ट                             |
| `--source-url <url>`            | स्रोत URL (GitHub इश्यू या PR)                          |
| `--execution-profile <profile>` | निष्पादन प्रोफ़ाइल (`deep` या `balanced`)               |
| `--priority <number>`           | प्राथमिकता संख्या (डिफ़ॉल्ट: 0)                         |
| `--verification <Name=Status>`  | सत्यापन प्रविष्टि (दोहराने योग्य)                       |
| `--related-plan <folder>`       | संबंधित योजना फ़ोल्डर का नाम (दोहराने योग्य)            |
| `--depends-on <folder>`         | निर्भरता योजना फ़ोल्डर का नाम (दोहराने योग्य)           |
| `--chat-session <id>`           | चैट सत्र के साथ संबद्ध करें                             |
| `--plans-dir <path>`            | योजना निर्देशिका पथ को ओवरराइड करें                     |
| `--no-duplicate-check`          | मौजूदा सक्रिय योजनाओं के विरुद्ध डुप्लिकेट पहचान छोड़ें |

#### plan list

```terminal
>tendril plan list [options]
```

वैकल्पिक फ़िल्टर के साथ योजनाओं की सूची बनाता है।

| Option                     | Effect                                                                        |
| -------------------------- | ----------------------------------------------------------------------------- |
| `--status` / `--state <s>` | स्थिति के अनुसार फ़िल्टर करें (उदा. `Draft`, `Executing`, `Failed`)           |
| `-p, --project <name>`     | प्रोजेक्ट नाम से फ़िल्टर करें (कॉन्फ़िगर किए गए प्रोजेक्ट्स के विरुद्ध मान्य) |
| `--level <level>`          | स्तर के अनुसार फ़िल्टर करें (उदा. `Bug`, `Feature`, `Epic`)                   |
| `--has-pr`                 | केवल वे योजनाएं जिनके पास संबद्ध PRs हैं                                      |
| `--has-worktree`           | केवल वे योजनाएं जिनके पास worktrees हैं                                       |
| `-q, --search <query>`     | शीर्षक या ID में टेक्स्ट खोज सबस्ट्रिंग द्वारा फ़िल्टर करें                   |
| `--limit <n>`              | परिणामों की अधिकतम संख्या                                                     |
| `--format <fmt>`           | आउटपुट प्रारूप: `table` (डिफ़ॉल्ट), `ids`, `folders`, `json`                  |
| `--plans-dir <path>`       | योजना निर्देशिका पथ को ओवरराइड करें                                           |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` योजनाएं दिखाता है (`plan.yaml` फ़ाइलों से), जॉब्स नहीं। जॉब इतिहास और निष्पादन स्थिति के लिए, इसके बजाय `job list` का उपयोग करें (देखें [Other Commands](05_Other.md#job-list))।

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

पूर्ण YAML प्रिंट करता है, या जब `[field]` प्रदान किया जाता है तो एकल फ़ील्ड मान प्रिंट करता है।

**अदिश फ़ील्ड (Scalar fields):** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**सूची फ़ील्ड (List fields):** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations` (प्रत्येक आइटम अपनी अलग पंक्ति पर)

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

एकल फ़ील्ड को अपडेट करता है और `updated` टाइमस्टैम्प को स्वचालित रूप से बढ़ाता है।

समर्थित फ़ील्ड: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`।

जब कोई भी सत्यापन `Fail` स्थिति में हो, तो `state` को `Completed` पर सेट करना अस्वीकार कर दिया जाता है: एक योजना जो पूर्ण दिखती है जबकि किसी गेट ने कार्य को अस्वीकार कर दिया है, डुप्लिकेट पहचान से गुम डिलिवरेबल को छुपाती है। सत्यापन को पुनः चलाएँ, या स्पष्ट कारण के साथ इसे `Skipped` पर सेट करें। `--allow-failed-verifications` पास करने से परिवर्तन वैसे भी रिकॉर्ड हो जाता है और `partialDelivery: true` सेट हो जाता है।

| Option                         | Effect                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `--allow-failed-verifications` | विफल सत्यापनों के साथ भी `Completed` में जाने की अनुमति दें                     |
| `--reason <text>`              | स्पष्ट करें कि संपादन क्यों किया गया था (सक्रिय चैट सत्रों को रिपोर्ट किया गया) |
| `--chat-session <id>`          | मूल चैट सत्र (स्वयं-अधिसूचना से बाहर रखा गया)                                   |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

`--file` या `--stdin` से संपूर्ण `plan.yaml` सामग्री को बदलता है (आवश्यक — `--stdin` अंतर्निहित नहीं है)।

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

किसी योजना की संशोधित फ़ाइलों में वायरफ़्रेम कोड रिसाव की जाँच करता है। यदि साफ़ है तो 0 से बाहर निकलता है, या यदि कोई वायरफ़्रेम मार्कर मिलता है तो डायग्नोस्टिक रिपोर्ट के साथ 1 से बाहर निकलता है।

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

जाँच करता है कि योजना में सभी आवश्यक फ़ील्ड हैं और यह आंतरिक रूप से सुसंगत है। संरचनात्मक त्रुटियों पर कोड `1` के साथ बाहर निकलता है।

## Repos

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

किसी योजना से जुड़ी रिपॉजिटरी की सूची प्रबंधित करें। किसी मौजूदा रेपो को जोड़ना एक idempotent no-op है।

## Links

```terminal
>tendril plan add-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan remove-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan add-commit <plan-id> <sha> [--reason <text>] [--chat-session <id>]
>tendril plan add-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan add-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
```

PR URLs, कमिट SHAs, संबंधित योजनाओं और ब्लॉकिंग निर्भरताओं को प्रबंधित करें। `add-depends-on` के कारण `ExecutePlan` निष्पादित करने से पहले निर्भरता के `Completed` स्थिति तक पहुँचने और इसके PRs के मर्ज होने की प्रतीक्षा करता है। सभी नामों का मिलान केस-इनसेंसिटिव तरीके से किया जाता है।

## Verifications

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

किसी योजना पर सत्यापन प्रबंधित करें। मान्य स्थितियाँ: `Pending`, `Pass`, `Fail`, `Skipped`। `add` के लिए डिफ़ॉल्ट स्थिति `Pending` है।

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

किसी योजना से जुड़े सभी git worktrees को हटा देता है। डिफ़ॉल्ट रूप से केवल टर्मिनल स्थिति (`Completed`, `Failed`, `Skipped`, `Icebox`) वाली योजनाओं पर चलता है। गैर-टर्मिनल योजनाओं के लिए worktrees को हटाने के लिए `--force` का उपयोग करें।

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

`origin/<base>` (डिफ़ॉल्ट: स्वतः पहचाना गया डिफ़ॉल्ट ब्रांच) से शाखा बनाते हुए, `<plan-folder>/Worktrees/<repo-name>` के तहत दी गई योजना के लिए एक git worktree बनाता है। शाखा का नाम `tendril/<plan-folder-name>` रखा गया है।

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

`Worktrees/<repo-name>` से एकल worktree को हटाता है। पहले `git worktree remove --force` का प्रयास करता है; विफल होने पर फ़ोर्स-डिलीट करता है। संबद्ध शाखा (डिफ़ॉल्ट रूप से `tendril/<plan-folder>`) को भी हटाता है।

## Revisions

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

stdin या `--file` से `Revisions/` में एक क्रमांकित संशोधन फ़ाइल (उदा. `002.md`) लिखता है। सत्यापन को बायपास करने के लिए `--no-question-check`, और ऑडिट एट्रिब्यूशन के लिए `--reason` / `--chat-session` का समर्थन करता है।

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

संशोधन सामग्री को stdout पर प्रिंट करता है — डिफ़ॉल्ट रूप से नवीनतम संशोधन, या जब `--number` दिया जाता है तो एक विशिष्ट क्रमांकित संशोधन।

## Questions

एक संशोधन fenced `questions` ब्लॉक में उपयोगकर्ता के लिए प्रश्न ले जा सकता है:

````markdown
```questions
questions:                    # 1-4 items
  - id:          string       # required, stable, unique across the whole revision
    title:       string       # required, the question
    header:      string       # optional, <=12 char chip label
    description: markdown     # optional, context shown under the question
    multiple:    bool         # optional, default false; true = multi-select
    options:                  # 2-4 items; omit entirely for a pure free-text question
      - title:       string   # required, 1-5 words
        description: markdown # optional
        value:       slug     # required, ^[a-z0-9][a-z0-9-]*$, referenced by `answer`
        recommended: bool     # optional, max one per question
    answer:      value | [values] | string   # filled in on response
```
````

`write-revision` इस स्कीमा के विरुद्ध प्रत्येक प्रश्न ब्लॉक को मान्य करता है और यदि कोई ब्लॉक विकृत है तो संशोधन को अस्वीकार कर देता है। `--no-question-check` का उपयोग केवल स्वचालित परीक्षणों में करें।

## Recommendations

```terminal
>tendril plan rec list <plan-id> [--state <state>]
>tendril plan rec all [--project <project>] [--state <state>]
>tendril plan rec rebuild
>tendril plan rec add <plan-id> <title> [-d <description>] [--impact <level>]
>tendril plan rec set <plan-id> <title> <field> <value>
>tendril plan rec accept <plan-id> <title> [--notes <text>]
>tendril plan rec decline <plan-id> <title> [--reason <text>] [--edit-reason <text>]
>tendril plan rec remove <plan-id> <title>
```

किसी योजना के YAML में संग्रहीत अनुशंसाओं को प्रबंधित करें:

- **list** — किसी योजना के लिए अनुशंसाओं की सूची बनाएं; स्थिति के अनुसार फ़िल्टर करें: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — प्रत्येक योजना में अनुशंसाओं की सूची बनाएं
- **rebuild** — डिस्क से डीनॉर्मलाइज़्ड अनुशंसा प्रोजेक्शन का पुनर्निर्माण करें
- **add** — प्रभाव स्तर: `Small`, `Medium`, `High`
- **set** — समर्थित फ़ील्ड: `title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — स्थिति को `Accepted` पर सेट करता है, या यदि `--notes` प्रदान किया गया है तो `AcceptedWithNotes` पर सेट करता है
- **decline** — स्थिति को `Declined` पर सेट करता है। `--reason` रिकॉर्ड करता है कि इसे `plan.yaml` में क्यों अस्वीकार किया गया था; `--edit-reason` चैट सत्रों के लिए अधिसूचना कारण निर्दिष्ट करता है
- **remove** — किसी अनुशंसा को स्थायी रूप से हटा देता है

## Environment

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

योजना के पोर्ट आवंटन और पर्यावरण फ़ाइलों का निरीक्षण करें और लिखें:

- **materialize** — गैर-विरोधाभासी सेवा पोर्ट आवंटित करता है और योजना के worktrees में पर्यावरण फ़ाइलें लिखता है। मौजूदा फ़ाइलों को अधिलेखित करने के लिए `--force` का उपयोग करें।
- **get** — worktree के लिए आवंटित पोर्ट और हल किए गए पर्यावरण चर प्रिंट करता है।

## Doctor

```terminal
>tendril plan doctor [options]
```

योजना निर्देशिका में प्रत्येक फ़ोल्डर को स्कैन करता है और स्वास्थ्य समस्याओं की रिपोर्ट करता है।

| Option          | Effect                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| `--fix`         | योजना स्कीमा को नवीनतम संस्करण में स्वचालित रूप से माइग्रेट करें                        |
| `--prs`         | `gh` के माध्यम से GitHub के विरुद्ध प्रत्येक रिकॉर्ड किए गए पुल अनुरोध को सत्यापित करें |
| `--prune-husks` | खाली योजना फ़ोल्डर हटाएं जिनमें कोई संशोधन और कोई कार्य कलाकृतियाँ (artifacts) नहीं हैं |
| `--dry-run`     | `--prune-husks` के साथ, रिपोर्ट करें कि बिना हटाए क्या हटाया जाएगा                      |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### Partial delivery backfill

रिपोर्ट में `Fail` स्थिति में सत्यापन वाली और बिना `partialDelivery` फ़्लैग वाली `Completed` के रूप में चिह्नित योजनाओं की सूची दी गई है। ये कंप्लीशन गार्ड से पहले की हैं। आंशिक डिलीवरी को स्वीकार करने के लिए:

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
