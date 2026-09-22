---
title: कॉन्फ़िगरेशन
description: Tendril सेटिंग्स, एनवायरनमेंट वेरिएबल्स, डीमन ऑप्शंस और प्रोजेक्ट
  प्रोफाइल कॉन्फ़िगर करें।
icon: Settings
groupExpanded: true
searchHints:
  - कॉन्फ़िग
  - सेटिंग्स
  - ऑप्शंस
  - प्राथमिकताएं
  - एनवायरनमेंट
---

# कॉन्फ़िगरेशन

Tendril अपनी सेटिंग्स, प्रोजेक्ट्स और निष्पादन प्राथमिकताओं को `$TENDRIL_HOME/config.yaml` पर स्थित एक केंद्रीकृत [YAML](https://yaml.org) कॉन्फ़िगरेशन फ़ाइल में संग्रहीत करता है।

यह अनुभाग वैश्विक Tendril एनवायरनमेंट को कॉन्फ़िगर करने, [प्रोजेक्ट सेटअप](02_Projects.md) को प्रबंधित करने, डीमन सेटिंग्स को समायोजित करने और [कोडिंग एजेंट](../06_CodingAgents/_Index.md) प्रोफाइल सेट करने को कवर करता है:

- [सेटअप और सेटिंग्स](01_Setup.md) — Settings UI या `$TENDRIL_HOME/config.yaml` में वैश्विक विकल्प कॉन्फ़िगर करें, [कोडिंग एजेंट्स](../06_CodingAgents/_Index.md), सत्र प्रमाणीकरण, [Cloudflare](https://www.cloudflare.com) टनल और अंतर्निहित [सत्यापन](01_Setup.md#verifications) प्रबंधित करें।
- [प्रोजेक्ट सेटअप](02_Projects.md) — [Git](https://git-scm.com) रिपॉजिटरी पंजीकृत करें, विज़ुअल कलर स्वैच, सत्यापन पाइपलाइन, समीक्षा क्रियाएं, पोर्ट आवंटन, [Docker](https://www.docker.com) सैंडबॉक्सिंग, [MCP](../09_Advanced/03_MCP.md) सर्वर और [Git worktree](02_Projects.md#repositories--git-worktrees) अलगाव कॉन्फ़िगर करें।

योजनाएं और प्रॉम्प्टवेयर कैसे काम करते हैं, इस पर वैचारिक पृष्ठभूमि के लिए, [योजनाएं](../02_Concepts/01_Plans.md), [प्रॉम्प्टवेयर](../02_Concepts/02_Promptwares.md), और [योजना जीवनचक्र](../02_Concepts/03_Lifecycle.md) देखें।
