---
title: सत्यापन (verification)
description: config.yaml में संग्रहीत वैश्विक सत्यापन परिभाषाओं का प्रबंधन करें।
  इन्हें प्रोजेक्ट्स और प्लान्स द्वारा संदर्भित किया जा सकता है।
icon: ClipboardCheck
searchHints:
  - सत्यापन (verification)
  - सत्यापित करें (verify)
  - जांच (check)
  - प्रॉम्प्ट (prompt)
  - परिभाषा (definition)
  - गेट्स (gates)
---

# सत्यापन (verification)

`config.yaml` में संग्रहीत वैश्विक सत्यापन परिभाषाओं का प्रबंधन करें। सत्यापन गेट्स (Verification gates) स्वचालित गुणवत्ता, निर्माण (build), और परीक्षण जांच को परिभाषित करते हैं जिन्हें कोडिंग एजेंटों को संतुष्ट करना होगा इससे पहले कि कोई [प्लान](01_Plan.md) `Completed` स्थिति में जा सके। इन्हें [`tendril project add-verification`](02_Project.md#verifications) के माध्यम से प्रोजेक्ट्स को सौंपा जाता है।

## Commands

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — सभी पंजीकृत वैश्विक सत्यापनों को प्रदर्शित करता है। संरचित JSON के रूप में आउटपुट प्राप्त करने के लिए `--json` पास करें।
- **get** — सत्यापन का नाम और पूर्ण मूल्यांकन प्रॉम्प्ट टेक्स्ट stdout पर प्रिंट करता है।
- **add** — वैकल्पिक प्रॉम्प्ट विवरण के साथ एक नई सत्यापन जांच पंजीकृत करता है।
- **set** — किसी सत्यापन परिभाषा के प्रॉम्प्ट को अपडेट करता है या उसका नाम बदलता है। सत्यापन का नाम बदलने से सभी प्रोजेक्ट संदर्भ, प्लान YAML रिकॉर्ड्स, और डेटाबेस पंक्तियाँ स्वचालित रूप से अपडेट हो जाती हैं।
- **remove** — सत्यापन परिभाषा को हटाता है। यदि कोई सक्रिय प्रोजेक्ट उस जांच को संदर्भित करता है, तो Tendril हटाने से इनकार कर देता है जब तक कि `--force` (या `-f`) प्रदान न किया जाए, जो सभी प्रोजेक्ट्स में संदर्भों को साफ कर देता है।

## Examples

```terminal
># Add a new verification gate with prompt instructions
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># Inspect full prompt details
>tendril verification get CargoTest

># Update the evaluation prompt
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># Rename a verification definition across projects and plans
>tendril verification set CargoTest --new-name RustWorkspaceTests

># List all definitions in JSON format
>tendril verification list --json

># Remove a verification, cleaning up project references
>tendril verification remove RustWorkspaceTests --force
```

## संबंधित (Related)

- [प्रोजेक्ट सत्यापन](02_Project.md#verifications) — कॉन्फ़िगर करें कि किसी प्रोजेक्ट के लिए कौन सी जांच आवश्यक है
- [प्लान सत्यापन](01_Plan.md#verifications) — किसी प्लान पर सत्यापन गेट की स्थितियों का निरीक्षण करें या उन्हें ओवरराइड करें
- [कॉन्फ़िगरेशन संदर्भ](../../03_Configuration/01_Setup.md) — `config.yaml` में वैश्विक सेटिंग्स प्रबंधित करें
