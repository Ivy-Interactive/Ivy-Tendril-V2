---
title: प्रोजेक्ट सेटअप
description: प्रत्येक प्रोजेक्ट एक git रेपो है जिसमें इसके अपने सत्यापन और एजेंट
  संदर्भ होते हैं। Tendril कई प्रोजेक्ट्स को साथ-साथ चलाता है।
icon: FolderGit
searchHints:
  - प्रोजेक्ट
  - रेपो
  - रिपॉजिटरी
  - मल्टी-प्रोजेक्ट
  - आइसोलेशन
  - वर्क-ट्री
  - डेंजर ज़ोन
  - mcp
  - सैंडबॉक्सिंग
---

# प्रोजेक्ट सेटअप

Tendril एक साथ कई प्रोजेक्ट्स के प्रबंधन का समर्थन करता है। प्रत्येक प्रोजेक्ट अपने स्वयं के [Git](https://git-scm.com) रिपॉजिटरी, सत्यापन गेट्स, पोर्ट आवंटन, पर्यावरण चर (environment variables), सुरक्षा सैंडबॉक्स और कस्टम स्किल्स को परिभाषित करता है।

## प्रोजेक्ट जोड़ना और प्रबंधित करना

प्रोजेक्ट्स को **Settings > Projects** के माध्यम से विज़ुअली कॉन्फ़िगर किया जा सकता है या उन्हें `$TENDRIL_HOME/config.yaml` में घोषित करके कॉन्फ़िगर किया जा सकता है (देखें [सेटअप और सेटिंग्स](01_Setup.md)):

- **प्रोजेक्ट जोड़ें विज़ार्ड (Add Project Wizard)** — प्रोजेक्ट को उसके रिपॉजिटरी पथ, प्रारंभिक रंग और डिफ़ॉल्ट सत्यापन गेट्स के साथ पंजीकृत करने के लिए सेटिंग्स साइडबार में **Add Project** पर क्लिक करें।
- **इनलाइन नाम बदलना (Inline Renaming)** — प्रोजेक्ट का नाम बदलने के लिए हेडर में प्रोजेक्ट नाम के बगल में स्थित एडिट पेंसिल आइकन पर क्लिक करें। Tendril डुप्लिकेट सिबलिंग नामों के विरुद्ध सत्यापन करता है और संबद्ध प्लान रिकॉर्ड्स को स्वचालित रूप से अपडेट करता है।
- **कलर स्वैच पिकर (Color Swatch Picker)** — 32 Ivy कलर पैलेट स्वैच ग्रिड (`ColorSwatchField`) से एक एक्सेंट रंग चुनें। यह रंग प्रोजेक्ट को [डैशबोर्ड](../04_Apps/01_Dashboard.md), [प्लान्स](../04_Apps/03_Plans.md) कतार, [समीक्षा](../04_Apps/02_Review.md) कतार, और [पुल रिक्वेस्ट्स](../04_Apps/06_PullRequests.md) ट्रैकर में अलग पहचान देता है।
- **संदर्भ (Context)** — डोमेन शब्दावली, वास्तुकला संबंधी बाधाओं (architectural constraints) और कोडिंग मानकों का वर्णन करने वाले मार्कडाउन निर्देश। यह संदर्भ प्रोजेक्ट पर सभी एजेंट रनों के लिए प्रॉम्प्टवेयर निर्देशों से पहले जोड़ा (prepend किया) जाता है।

### `config.yaml` उदाहरण

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Core engine services written in Rust with a TypeScript CLI.
      Follow standard Ivy design tokens and ensure all tests pass.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
    reviewActions:
      - name: Run E2E
        command: pnpm test:e2e
        condition: "${hasChanges}"
    ports:
      backend:
        defaultPort: 8080
        description: API gateway service
    envFiles:
      - path: .env
        template: .env.example
        overrides:
          PORT: "${ports.backend}"
          DATABASE_URL: "sqlite://${env.TENDRIL_HOME}/dev.db"
    wireframes: true
    wireframeGuard: true
    sandboxMode: Off
    securityPreset: Standard
```

## रिपॉजिटरी और Git वर्क-ट्रीज़

Tendril प्रोजेक्ट्स एक या अधिक [Git](https://git-scm.com) रिपॉजिटरीज़ (`repos:`) को लिंक करते हैं।

जब कोई एजेंट `ExecutePlan` के माध्यम से किसी प्लान को निष्पादित करता है, तो यह कोड जेनरेशन को आपके स्थानीय विकास परिवेश (local development environment) से अलग (isolate) करता है:

- **समर्पित Git वर्क-ट्रीज़ (Dedicated Git Worktrees)** — Tendril आपकी लक्षित शाखा (target branch) से अलग एक पृथक Git वर्क-ट्री शाखा (`tendril/<planId>-<slug>`) बनाता है। आपका वर्किंग ट्री, शाखा और IDE अप्रभावित रहते हैं।
- **समवर्ती निष्पादन (Concurrent Execution)** — git लॉक विरोध के बिना विभिन्न रिपॉजिटरीज़ में एक साथ कई प्लान निष्पादित हो सकते हैं।
- **सुरक्षित विफलता और त्याग (Safe Failure & Discard)** — विफल या अस्वीकृत रनों को मैन्युअल git क्लीनअप के बिना साफ-सुथरे तरीके से हटाया जा सकता है।
- **वर्क-ट्री रीपर (Worktree Reaper)** — [सेटअप और सेटिंग्स](01_Setup.md) में `worktreeReaperInterval` और `worktreeReaperGrace` सेटिंग्स के अनुसार स्वचालित बैकग्राउंड क्लीनअप निष्क्रिय या पूर्ण हो चुके वर्क-ट्रीज़ को साफ़ करता है।

## सत्यापन पाइपलाइन (Verification Pipelines)

प्रोजेक्ट सत्यापन गेट्स का एक क्रमबद्ध क्रम परिभाषित करते हैं जिसे काम के [समीक्षा](../04_Apps/02_Review.md) तक पहुँचने से पहले एजेंटों को पूरा करना होगा:

- **क्रमबद्ध करने योग्य क्रम (Sortable Order)** — सत्यापन चरणों को इच्छित निष्पादन क्रम (`SortableVerificationList`) में ड्रैग और ड्रॉप करें।
- **आवश्यक गेट्स (Required Gates)** — सत्यापनों को आवश्यक के रूप में चिह्नित करें। कोई प्लान [समीक्षा](../04_Apps/02_Review.md) में केवल तभी `Verified` के रूप में दिखाई देता है जब सभी आवश्यक सत्यापन सफल होते हैं।
- **कस्टम सत्यापन (Custom Verifications)** — प्रोजेक्ट-विशिष्ट कमांड और कस्टम सत्यापन प्रॉम्प्ट जोड़ें (उदा. `cargo clippy`, `pnpm check`, `pytest`)। कमांड-लाइन प्रबंधन के लिए [CLI सत्यापन](../09_Advanced/01_CLI/03_Verification.md) देखें।

## समीक्षा क्रियाएं (Review Actions)

[समीक्षा](../04_Apps/02_Review.md) ऐप टूलबार (`reviewActions:`) में प्रदर्शित होने वाले वन-क्लिक एक्शन बटन परिभाषित करें:

- `name` — टूलबार बटन पर प्रदर्शित एक्शन लेबल।
- `command` — प्लान के वर्क-ट्री में निष्पादित शेल कमांड।
- `condition` — वैकल्पिक निष्पादन शर्त (जैसे कि `${hasChanges}`)।

## पोर्ट्स और पर्यावरण फ़ाइलें (Ports & Environment Files)

जटिल प्रोजेक्ट्स को अक्सर पृथक पोर्ट्स और पर्यावरण कॉन्फ़िगरेशन की आवश्यकता होती है:

- **पोर्ट आवंटन (`ports:`)** — नामित पोर्ट्स घोषित करें (उदा. `backend`, `frontend`)। यदि डिफ़ॉल्ट पोर्ट पहले से उपयोग में है, तो Tendril एक खुला पोर्ट आवंटित करता है और इसे `${ports.<name>}` प्लेसहोल्डर के माध्यम से उपलब्ध कराता है।
- **पर्यावरण फ़ाइलें (`envFiles:`)** — एक बेस टेम्पलेट (उदा. `.env.example`) और `${ports.<name>}`, `${env.<VAR>}`, व `%VAR%` चरों का समर्थन करने वाले पंक्ति-दर-पंक्ति कुंजी/मान ओवरराइड्स से एजेंट वर्क-ट्रीज़ के अंदर स्वचालित रूप से `.env` फ़ाइलें फिर से बनाएं।

## एजेंट सुरक्षा और सैंडबॉक्सिंग

Tendril विस्तृत प्रोजेक्ट-स्तरीय सुरक्षा नियंत्रण प्रदान करता है:

- **सुरक्षा प्रीसेट (Security Presets)** — `Strict`, `Standard`, `Permissive`, या `Custom` का चयन करें। प्रीसेट डिफ़ॉल्ट सैंडबॉक्सिंग और फ़ाइल एक्सेस नियमों को कॉन्फ़िगर करते हैं।
- **सैंडबॉक्स मोड (Sandbox Mode)** — रनटाइम आइसोलेशन का चयन करें: `Off`, [Docker](https://www.docker.com), या [Bubblewrap](https://github.com/containers/bubblewrap)।
- **बाहरी फ़ाइल एक्सेस (Outside File Access)** — नियंत्रित करें कि क्या एजेंट रिपॉजिटरी ट्री के बाहर की फ़ाइलों को पढ़ सकते हैं (`Deny`, `ReadOnly`, `Full`)।
- **टर्मिनल स्वचालित निष्पादन (Terminal Auto-Execution)** — चुनें कि एजेंट स्वचालित रूप से शेल कमांड निष्पादित करें (`AllowAll`), पुष्टि के लिए पूछें (`RequireConfirmation`), या कमांड निष्पादन को अस्वीकार करें (`DenyAll`)।
- **फ़ाइल अनुमतियाँ (File Permissions)** — विशिष्ट पथ नियम कॉन्फ़िगर करें: `Allow <path>`, `Ask <path>`, या `Deny <path>`।
- **वायरफ्रेम और वायरफ्रेम गार्ड (Wireframes & Wireframe Guard)** — प्लान्स में UI प्रोटोटाइप जेनरेशन को सक्षम करने के लिए `wireframes` को टॉगल करें, और यह सत्यापित करने के लिए `wireframeGuard` को टॉगल करें कि अस्थायी वायरफ्रेम कोड को प्रोडक्शन पुल रिक्वेस्ट्स में शामिल करने से पहले जांचा गया है।

## प्रोजेक्ट MCP सर्वर और स्किल्स

किसी विशिष्ट प्रोजेक्ट के लिए एजेंट क्षमताओं का विस्तार करें:

- **MCP सर्वर (`mcpServers:`)** — कस्टम निष्पादन योग्य फ़ाइलों, तर्कों (arguments) और पर्यावरण चरों के साथ प्रोजेक्ट-स्कोप्ड [Model Context Protocol](https://modelcontextprotocol.io) सर्वर पंजीकृत करें। देखें [MCP एकीकरण](../09_Advanced/03_MCP.md)।
- **स्किल्स (`skills:`)** — एजेंटों को प्रोजेक्ट-विशिष्ट प्रक्रियाओं और मार्कडाउन निर्देशों से लैस करें। देखें [स्किल्स गाइड](../06_CodingAgents/00_Skills.md)।

## रेपो-स्थानीय संदर्भ (Repo-Local Context)

Tendril रिपॉजिटरी रूट से दस्तावेज़ीकरण का स्वचालित रूप से पता लगाता है और उसे प्रॉम्प्टवेयर संदर्भ में पहले जोड़ता है:

- **`CLAUDE.md`** — Claude Code के लिए मार्गदर्शन और परंपराएँ। देखें [Claude Code गाइड](../06_CodingAgents/01_ClaudeCode.md)।
- **`AGENTS.md` / `DEVELOPER.md`** — टीम विकास मानक, परीक्षण आवश्यकताएं, और कोडबेस परंपराएं।

## डेंजर ज़ोन: निकालें (Remove) बनाम हटाएं (Delete)

प्रोजेक्ट सेटिंग्स डेंजर ज़ोन में दो अलग-अलग निष्कासन विकल्पों के साथ समाप्त होती है:

```
[ Remove Project ]  (Outline)
Removes the project from config.yaml. Cloned repositories, plan folders and history
are left on disk, so adding the project back by name restores it.

[ Delete Project ]  (Destructive)
Permanently deletes the project's plans, its cloned repositories under
<TENDRIL_HOME>/Projects/, its database rows and its config entry. This cannot be
undone, and asks you to type the project name first.
```

> [!WARNING]
> **Remove Project** केवल डिस्क पर फ़ाइलों को सुरक्षित रखते हुए कॉन्फ़िगरेशन से प्रोजेक्ट को अपंजीकृत करता है। **Delete Project** रिपॉजिटरीज़, प्लान्स और डेटाबेस रिकॉर्ड्स को स्थायी रूप से हटा देता है, जिसके लिए पुष्टि करने के लिए सटीक प्रोजेक्ट नाम टाइप करना आवश्यक होता है।
