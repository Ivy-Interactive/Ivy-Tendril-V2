---
title: ट्यूटोरियल
description: "एक संपूर्ण एंड-टू-एंड वॉकथ्रू: Tendril को बिल्ड करें, एक लोकल
  रिपॉजिटरी रजिस्टर करें, अपनी पहली योजना बनाएं, इसे एक एजेंट के साथ निष्पादित
  करें, परिणाम की समीक्षा करें और एक पुल रिक्वेस्ट खोलें।"
icon: GraduationCap
searchHints:
  - ट्यूटोरियल
  - वॉकथ्रू
  - त्वरित शुरुआत
  - पहली योजना
  - एंड टू एंड
  - उदाहरण
---

# ट्यूटोरियल

यह आपकी पसंद की रिपॉजिटरी पर संपूर्ण एंड-टू-एंड वर्कफ़्लो है। इसमें प्रोजेक्ट रजिस्टर करना,
योजना बनाना, अलग किए गए वर्क-ट्री में बदलाव निष्पादित करना, डिफ्स की समीक्षा करना और एक पुल रिक्वेस्ट भेजना शामिल है।

## चरण 1: बिल्ड करें और सत्यापित करें

Tendril को इंस्टॉल या बिल्ड करने और `tendril` को अपने `PATH` में जोड़ने के लिए [Installation](02_Installation.md) का पालन करें।
अपने परिवेश को सत्यापित करें:

```bash
tendril doctor
```

`tendril doctor` आपके `$TENDRIL_HOME`, `config.yaml`, [SQLite](https://www.sqlite.org) डेटाबेस,
प्लान डायरेक्टरी, [Git](https://git-scm.com/), और [GitHub CLI](https://cli.github.com/) (`gh`) का ऑडिट करता है। आगे बढ़ने से पहले किसी भी
`[FAIL]` आइटम का समाधान करें।

## चरण 2: Tendril शुरू करें

डेस्कटॉप एप्लिकेशन लॉन्च करें:

```bash
pnpm dev:desktop
```

डेस्कटॉप ऐप लॉन्च होता है और बैकग्राउंड में `tendril run` डीमन की स्वचालित रूप से निगरानी करता है। यह
डीमन REST और WebSocket API को एक्सपोज़ करता है जिसके माध्यम से डेस्कटॉप UI और CLI संवाद करते हैं।

यदि आप डीमन को हेडलेस रूप से चलाना पसंद करते हैं:

```bash
# Checks port and runs pending migrations
tendril run

# Or direct listener with custom options:
tendril serve --host 127.0.0.1 --port 5010
```

## चरण 3: अपनी रिपॉजिटरी रजिस्टर करें

Tendril को काम करने के लिए एक लोकल गिट रिपॉजिटरी की आवश्यकता होती है:

```bash
git clone https://github.com/your-org/your-repo.git
```

डेस्कटॉप ऐप के **Settings → Projects** से, या CLI के माध्यम से प्रोजेक्ट रजिस्टर करें:

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

दोनों विधियां `$TENDRIL_HOME/config.yaml` को अपडेट करती हैं, जिसे आप मैन्युअल रूप से भी संपादित कर सकते हैं:

```yaml
codingAgent: claude

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

`codingAgent` को अपने इंस्टॉल किए गए एजेंट पर सेट करें:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (ऑन-डिवाइस `fm` के माध्यम से `apple`)

> [!TIP]
> अपनी रिपॉजिटरी के रूट पर एक `AGENTS.md` फ़ाइल जोड़ें जिसमें वास्तुशिल्प परंपराओं और बिल्ड कमांड का विवरण हो।
> Tendril इसे हर रन पर एजेंट के सिस्टम संदर्भ में इंजेक्ट करता है। अनुशंसाओं के लिए
> [Onboarding a Codebase](03_Onboarding.md) देखें।

## चरण 4: एक योजना बनाएं

डेस्कटॉप ऐप में **New Plan** पर क्लिक करें और एक कार्य विवरण प्रदान करें। Tendril
[CreatePlan](../02_Concepts/02_Promptwares.md) वर्कफ़्लो एजेंट को भेजता है, जो समस्या विवरण, चरणबद्ध समाधान और सत्यापन लक्ष्यों से युक्त एक संरचित योजना का मसौदा तैयार करता है।

आप CLI से भी योजनाएं बना सकते हैं:

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

योजना **Draft** स्थिति में प्रवेश करती है। प्रस्तावित विनिर्देश का निरीक्षण करने के लिए योजना मसौदा खोलें। आप स्कोप को सही करने या बाधाएं जोड़ने के लिए सीधे UI में इनलाइन एनोटेशन जोड़ सकते हैं, जो
[UpdatePlan](../02_Concepts/02_Promptwares.md) को आपके फीडबैक को एक संशोधित संस्करण में संश्लेषित करने के लिए प्रेरित करता है।

## चरण 5: योजना को निष्पादित करें

जब मसौदा आपकी आवश्यकताओं को पूरा करता है, तो **Execute** पर क्लिक करें (या `tendril plan execute <plan-id>` चलाएं)।
[ExecutePlan](../02_Concepts/02_Promptwares.md) एजेंट:

1. `Worktrees/{repo-name}/` के तहत एक पृथक [Git worktree](https://git-scm.com/docs/git-worktree) बनाता है,
   जिससे आपकी प्राथमिक शाखा अप्रभावित रहती है;
2. योजना विनिर्देश, रिपॉजिटरी संदर्भ, और मेमोरी नोट्स लोड करता है;
3. वृद्धिशील गिट कमिट के साथ चरण-दर-चरण कोड संशोधनों को लागू करता है;
4. प्रत्येक कॉन्फ़िगर किए गए सत्यापन गेट (बिल्ड, लिंट, टेस्ट, स्क्रीनशॉट) को चलाता है।

डेस्कटॉप **Jobs** दृश्य में या CLI के माध्यम से निष्पादन की लाइव निगरानी करें:

```bash
tendril job list          # view job statuses
tendril job queue         # inspect dispatch queue order
```

जब सभी चरण पूरे हो जाते हैं और आवश्यक सत्यापन पास हो जाते हैं, तो योजना **Review** में बदल जाती है।

> [!NOTE]
> यदि कोई सत्यापन जाँच विफल हो जाती है, तो योजना **Failed** स्थिति में प्रवेश करती है और वर्क-ट्री को डिस्क पर सुरक्षित रखा जाता है। त्रुटि रिपोर्ट का निरीक्षण `Verification/` के तहत करें या एजेंट को समस्या को ठीक करने की अनुमति देने के लिए
> [RetryPlan](../02_Concepts/02_Promptwares.md) चलाएं।

## चरण 6: परिणाम की समीक्षा करें

कार्य का निरीक्षण करने के लिए योजना की **Review** स्क्रीन पर नेविगेट करें:

- **Git Diff** — प्रभावित फ़ाइलों में सिंटैक्स-हाइलाइट किए गए डिफ्स ब्राउज़ करें;
- **Verification Reports** — स्वचालित बिल्ड और टेस्ट आउटपुट की समीक्षा करें;
- **Execution Transcripts** — टूल कॉल ट्रेस, stdout/stderr, और टोकन लागत पढ़ें;
- **Follow-up Recommendations** — एजेंट द्वारा चिह्नित तकनीकी ऋण या सुधारों का निरीक्षण करें।

संतुष्ट होने पर योजना को स्वीकृति दें। Tendril
[GitHub CLI](https://cli.github.com/) (`gh`) के माध्यम से एक पुल रिक्वेस्ट खोलने के लिए
[CreatePr](../02_Concepts/02_Promptwares.md) को ट्रिगर करता है, जिससे योजना **Completed** में चली जाती है।

## अभी क्या हुआ

आपने मानक Tendril विकास चक्र पूरा कर लिया है:

```
Draft → Creating → Executing → Review → Completed
```

स्वायत्त एजेंट ने एक सैंडबॉक्स वर्क-ट्री में काम किया, आपके सत्यापन गेटों को संतुष्ट किया, और `$TENDRIL_HOME/Plans/` के तहत सभी प्रॉम्प्ट्स, डिफ्स और लागतों को रिकॉर्ड करते हुए एक ऑडिटेड पुल रिक्वेस्ट तैयार की।

## अगले कदम

- [Plans](../02_Concepts/01_Plans.md) — योजना संरचना, स्थितियों और एनोटेशन की गहराई से समझ।
- [Promptwares](../02_Concepts/02_Promptwares.md) — वर्कफ़्लो एजेंट प्रॉम्प्ट्स, टूल्स और मेमोरी को कस्टमाइज़ करें।
- [Lifecycle & Jobs](../02_Concepts/03_Lifecycle.md) — समवर्तीता, कतारबद्धता और टेलीमेट्री को समझें।
