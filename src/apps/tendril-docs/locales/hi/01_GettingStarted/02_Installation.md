---
title: इंस्टॉलेशन
description: प्री-बिल्ट बाइनरी के माध्यम से Tendril इंस्टॉल करें या सोर्स से
  बिल्ड करें, डेस्कटॉप ऐप और CLI चलाएं, और अपना वातावरण कॉन्फ़िगर करें।
icon: Download
searchHints:
  - इंस्टॉल
  - प्री-बिल्ट बाइनरी
  - सोर्स से बिल्ड करें
  - पूर्वापेक्षाएँ
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - अपडेट
---

# इंस्टॉलेशन

Tendril को प्री-बिल्ट डेस्कटॉप पैकेज और CLI बाइनरी के माध्यम से इंस्टॉल किया जा सकता है, या स्थानीय रूप से सोर्स से बिल्ड किया जा सकता है।

## त्वरित इंस्टॉलेशन

स्टैंडअलोन डेस्कटॉप इंस्टॉलर (`.dmg`, `.pkg`, `.exe`, `.AppImage`, `.deb`) सीधे
[GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) से डाउनलोड करें या स्वचालित इंस्टॉल स्क्रिप्ट्स में से एक चलाएं:

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

इंस्टॉलर `tendril` CLI बाइनरी को आपके `PATH` पर रखता है और आपके सिस्टम मेनू में डेस्कटॉप एप्लिकेशन को पंजीकृत करता है।

## पूर्वापेक्षाएँ (सोर्स से बिल्ड करने के लिए)

यदि सोर्स से बिल्ड कर रहे हैं, तो सुनिश्चित करें कि ये निर्भरताएँ इंस्टॉल हैं और आपके `PATH` पर उपलब्ध हैं:

| टूल                                          | संस्करण                  | भूमिका                                                                                           |
| -------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (2021 edition)     | नेटिव CLI, सर्वर डेमॉन, और कोर को कंपाइल करता है।                                                |
| [Node.js](https://nodejs.org/)               | 22 या नया                | फ्रंट-एंड टूलिंग और बिल्ड स्क्रिप्ट्स को संचालित करता है।                                        |
| [pnpm](https://pnpm.io/)                     | 11 या नया                | वर्कस्पेस पैकेज और निर्भरताओं का प्रबंधन करता है।                                                |
| [Vite+](https://viteplus.dev/) (`vp`)        | वर्तमान                  | बिल्डिंग, लिंटिंग, फॉर्मेटिंग, टेस्टिंग को ऑर्केस्ट्रेट करता है।                                 |
| [Git](https://git-scm.com/)                  | 2.30+                    | [git worktrees](https://git-scm.com/docs/git-worktree), कमिट्स, और ब्रांचिंग का प्रबंधन करता है। |
| [GitHub CLI](https://cli.github.com/) (`gh`) | प्रमाणित (authenticated) | पुल रिक्वेस्ट खोलता है और समस्याओं (issues) को स्वचालित रूप से प्रबंधित करता है।                 |

आपको कम से कम एक प्रमाणित कोडिंग एजेंट CLI (जैसे [Claude Code](https://code.claude.com/docs),
[GitHub Copilot](https://github.com/features/copilot), [Gemini](https://ai.google.dev),
[OpenCode](https://opencode.ai), [Antigravity](https://github.com/google-deepmind), या
[Cursor](https://www.cursor.com)) की भी आवश्यकता होगी। [कोडबेस को ऑनबोर्ड करना](03_Onboarding.md) एजेंट कॉन्फ़िगरेशन को विस्तार से कवर करता है।

## सोर्स से बिल्ड करें

रिपॉजिटरी को क्लोन करें और वर्कस्पेस निर्भरताओं को इंस्टॉल करें:

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # shared UI library, required by the desktop app
node src/scripts/ensure-wireframe-payload.mjs      # prepares wireframe assets for native build
cargo build --workspace                            # builds tendril-core, tendril-server, tendril-cli
```

> [!NOTE]
> नेटिव वर्कस्पेस क्रेट्स को कंपाइल करने से पहले `@ivy-interactive/components` लाइब्रेरी और वायरफ्रेम पेलोड जनरेट होना आवश्यक है, क्योंकि `tendril-app` और `tendril-wireframe` बिल्ड समय पर इन एसेट्स को इम्पोर्ट करते हैं।

## डेस्कटॉप ऐप चलाएं

हॉट मॉड्यूल रीलोडिंग के साथ स्थानीय विकास के लिए:

```bash
pnpm dev:desktop
```

यह कमांड आवश्यक साइडकार बाइनरी का निर्माण करती है और [Tauri 2](https://tauri.app) नेटिव विंडो के साथ Vite को लॉन्च करती है। डेस्कटॉप ऐप बैकग्राउंड डेमॉन (`tendril run`) को स्वचालित रूप से प्रबंधित करता है।

### स्टैंडअलोन रिलीज़ को पैकेज करना

अपने प्लेटफ़ॉर्म के लिए स्टैंडअलोन रिलीज़ बंडल को पैकेज करने के लिए:

```bash
cargo build --release --bin tendril

# Stage the native CLI sidecar for your target architecture
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# Fetch the bundled OpenCode sidecar agent
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# Build the installer package (DMG on macOS, NSIS/MSI on Windows, AppImage/deb on Linux)
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## CLI इंस्टॉल करें

`tendril` बाइनरी कमांड-लाइन इंटरफ़ेस और डेमॉन सर्वर दोनों के रूप में कार्य करती है:

```bash
cargo build --release --bin tendril
# or install directly to ~/.cargo/bin:
cargo install --path src/crates/tendril-cli
```

हेल्थ चेक डॉक्टर के साथ अपने इंस्टॉलेशन को सत्यापित करें:

```bash
tendril version
tendril doctor
```

`tendril doctor` आपके `$TENDRIL_HOME`, `config.yaml` सिंटैक्स, [SQLite](https://www.sqlite.org) डेटाबेस,
प्लान्स डायरेक्टरी, और आपके `git` तथा `gh` क्रेडेंशियल्स की पुष्टि करता है।

### डेमॉन को हेडलेस चलाना

डेस्कटॉप UI के बिना Tendril को हेडलेस सर्वर डेमॉन के रूप में चलाने के लिए:

```bash
# Recommended: checks port availability and executes pending database migrations
tendril run

# Or run the direct listener (supports --tls-cert and --tls-key)
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> सर्वर डिफ़ॉल्ट रूप से `127.0.0.1:5010` पर सुनता है (listens), जो REST और WebSocket एंडपॉइंट्स को एक्सपोज़ करता है। यह एक स्टैटिक वेब इंटरफ़ेस की सेवा नहीं देता है; डेस्कटॉप ऐप या CLI के माध्यम से इसके साथ इंटरैक्ट करें।

## कॉन्फ़िगरेशन और डायरेक्टरी लेआउट

सभी Tendril रनटाइम स्थिति `$TENDRIL_HOME` के भीतर संग्रहीत की जाती है, जिसे निम्नलिखित प्राथमिकता क्रम में हल किया जाता है:

1. `TENDRIL_HOME` पर्यावरण चर (environment variable);
2. `~/.tendril_location` में दर्ज किया गया पाथ (यदि मौजूद हो);
3. डिफ़ॉल्ट उपयोगकर्ता स्थान: `~/.tendril`।

`$TENDRIL_HOME` के अंदर:

```
~/.tendril/
├── config.yaml     # coding agent, project definitions, verifications, promptware overrides
├── tendril.db      # SQLite database for jobs, costs, and execution telemetry
├── Plans/          # structured plans and their isolated git worktrees
├── Jobs/           # execution logs, agent prompts, and raw transcript recordings
└── Promptwares/    # deployed workflow agent definitions
```

एक न्यूनतम `config.yaml`:

```yaml
codingAgent: claude
maxConcurrentJobs: 20

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

एजेंट परिभाषाओं को इनिशियलाइज़ करने के लिए मानक प्रॉम्टवेयर को डिप्लॉय करें:

```bash
tendril promptware deploy
```

> [!WARNING]
> अपना पहला काम शुरू करने से पहले सुनिश्चित करें कि आपका चुना हुआ कोडिंग एजेंट CLI प्रमाणित (authenticated) है। यदि कोई एजेंट एक अनअटेंडेड बैकग्राउंड प्रोसेस में क्रेडेंशियल्स के लिए प्रॉम्प्ट करने के लिए रुकता है, तो जॉब ब्लॉक हो जाएगा या टाइम आउट हो जाएगा।

## अपडेट करना

यदि इंस्टॉल स्क्रिप्ट के माध्यम से इंस्टॉल किया गया है, तो नवीनतम रिलीज़ प्राप्त करने के लिए वन-लाइनर को फिर से चलाएं।

यदि सोर्स चेकआउट से काम कर रहे हैं:

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## अगले कदम

- [कोडबेस को ऑनबोर्ड करना](03_Onboarding.md) — रिपॉजिटरी पूर्वापेक्षाएँ कॉन्फ़िगर करें और एजेंट एक्सेस सत्यापित करें।
- [अवधारणाएँ: योजनाएँ](../02_Concepts/01_Plans.md) — योजना संरचनाओं और समीक्षा जीवनचक्र को समझें।
- [समस्या निवारण](06_Troubleshooting.md) — बिल्ड और रनटाइम त्रुटियों के समाधान।
