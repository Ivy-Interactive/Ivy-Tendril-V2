# Tendril स्किल्स के लिए Claude Code सेटअप गाइड

यह गाइड Claude Code में Tendril Agent Skills को इंस्टॉल, कॉन्फ़िगर और टेस्ट करने की प्रक्रिया बताती है।

## 1. प्लगइन मार्केटप्लेस के माध्यम से इंस्टॉलेशन

Tendril `.claude-plugin/marketplace.json` और `.claude-plugin/plugin.json` पर आधिकारिक प्लगइन मेनिफ़ेस्ट प्रदान करता है।

Claude Code में, Ivy-Tendril-V2 रिपॉजिटरी को मार्केटप्लेस स्रोत के रूप में जोड़ें:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

इसके बाद `tendril-skills` प्लगइन इंस्टॉल करें:

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. स्थानीय विकास और परीक्षण (Local Development and Testing)

स्थानीय रूप से स्किल्स विकसित करते समय या बदलावों को पुश करने से पहले उनका परीक्षण करते समय:

प्लगइन डायरेक्टरी को अपने स्थानीय रिपॉजिटरी चेकआउट की ओर इंगित करते हुए Claude Code प्रारंभ करें:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Claude Code `.claude-plugin/plugin.json` को पढ़ेगा और `skills/` में परिभाषित सभी स्किल्स को स्वचालित रूप से माउंट कर देगा।

## 3. .claude/skills के साथ बैकवर्ड कम्पैटिबिलिटी

Ivy-Tendril-V2 के भीतर स्थानीय रिपॉजिटरी वर्कफ़्लो के लिए:
- `.claude/skills/<skill-name>` में सिम्लिंक (symlinks) `../../skills/<skill-name>` की ओर इंगित करते हैं।
- `.claude/skills/` को संदर्भित करने वाला कोई भी मौजूदा स्थानीय Claude Code कॉन्फ़िगरेशन बिना मैन्युअल री-कॉन्फ़िगरेशन के निर्बाध रूप से काम करता रहेगा।

## 4. Claude Code में स्किल्स का उपयोग (Invoking Skills)

एक बार इंस्टॉल होने के बाद, अपने Claude Code सत्र में सीधे स्लैश कमांड का उपयोग करें:

- `/tendril-debug-plan <plan-id>`: विफल या धीमे प्लान्स को डिबग करें।
- `/tendril-debug-job <job-id>`: जॉब आर्टिफ़ैक्ट्स और एजेंट निर्णय लॉग का निरीक्षण करें।
- `/tendril-review`: वर्तमान diffs पर कोड गुणवत्ता और रीग्रेशन जांच करें।
- `/tendrillable <url>`: स्वायत्त एजेंट रूब्रिक्स के अनुसार बैकलाग समस्याओं का वर्गीकरण करें।
- `/tendril-release`: वर्ज़न बम्प्स, डिपेंडेंसी अपडेट और रिलीज़ वर्कफ़्लो को स्वचालित करें।

## लाइसेंस

Tendril स्किल्स और प्लगइन्स रिपॉजिटरी रूट में मौजूद [Functional Source License (FSL-1.1-ALv2)](../LICENSE) के तहत लाइसेंस प्राप्त हैं।
