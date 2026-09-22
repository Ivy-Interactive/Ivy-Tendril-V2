---
title: Jam.dev
description: इनबॉक्स API वेबहुक के माध्यम से बग रिपोर्ट से स्वचालित रूप से
  योजनाएँ बनाने के लिए Tendril के साथ jam.dev को एकीकृत करें।
icon: Bug
searchHints:
  - jam
  - jam.dev
  - वेबहुक
  - इनबॉक्स api
  - बग रिपोर्ट
---

# Jam.dev

## अवलोकन

[Jam.dev](https://jam.dev) Tendril के इनबॉक्स API एंडपॉइंट पर बग रिपोर्ट भेज सकता है, जो `CreatePlan` [promptware](../02_Concepts/02_Promptwares.md) के माध्यम से स्वचालित रूप से [योजनाएँ](../02_Concepts/01_Plans.md) बनाता है। अंतर्निहित HTTP एंडपॉइंट्स पर विवरण के लिए, [REST API](../09_Advanced/02_REST.md) देखें।

## वेबहुक URL

[Jam.dev](https://jam.dev) को निम्नलिखित पर POST करने के लिए कॉन्फ़िगर करें:

```
http://localhost:5010/api/inbox
```

यदि अलग तरीके से कॉन्फ़िगर किया गया है, तो `localhost:5010` को अपने Tendril होस्ट और पोर्ट से बदलें। सर्वर कॉन्फ़िगरेशन के लिए, [सेटअप और सेटिंग्स](../03_Configuration/01_Setup.md) देखें।

## अनुरोध प्रारूप

JSON बॉडी के साथ एक POST अनुरोध भेजें:

```json
{
  "description": "Bug description from jam.dev",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| फ़ील्ड        | आवश्यक | विवरण                                                                                    |
| ------------- | ------ | ---------------------------------------------------------------------------------------- |
| `description` | हाँ    | बग रिपोर्ट या समस्या का विवरण                                                            |
| `project`     | नहीं   | लक्षित प्रोजेक्ट का नाम (डिफ़ॉल्ट रूप से `Auto`)                                         |
| `sourcePath`  | नहीं   | संबंधित स्रोत कोड के लिए पाथ संकेत                                                       |
| `force`       | नहीं   | यदि कोई समान कार्य पहले से चल रहा हो, तब भी निर्माण बाध्य करें (डिफ़ॉल्ट रूप से `false`) |

## प्रमाणीकरण

यदि आपने `config.yaml` में `api.apiKey` कॉन्फ़िगर किया है, तो इसे `X-Api-Key` अनुरोध हेडर के रूप में शामिल करें:

```http
X-Api-Key: your-api-key
```

आप इसके माध्यम से डीमन सीक्रेट का उपयोग करके भी प्रमाणित कर सकते हैं:

```http
Authorization: Bearer <secret>
```

> [!TIP]
> जब `api.apiKey` कॉन्फ़िगर नहीं होता है, तो डीमन सीक्रेट या स्थानीय लूपबैक कनेक्शन का उपयोग किया जाता है। टीम या दूरस्थ परिवेशों के लिए, `config.yaml` में एक API कुंजी कॉन्फ़िगर करें।

## प्रतिक्रिया

एक सफल अनुरोध HTTP 200 लौटाता है:

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

यदि एक `CreatePlan` कार्य पहले से प्रगति पर होने के दौरान एक समान विवरण सबमिट किया जाता है और `force` का मान `true` नहीं है, तो Tendril HTTP 409 Conflict लौटाता है:

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## jam.dev में सेटअप करना

1. अपनी jam.dev कार्यस्थान सेटिंग्स खोलें
2. एकीकरण (integrations) या वेबहुक पर नेविगेट करें
3. अपने Tendril इनबॉक्स URL (`http://localhost:5010/api/inbox`) को इंगित करने वाला एक नया वेबहुक जोड़ें
4. यदि प्रमाणीकरण सक्षम है तो हेडर (जैसे `X-Api-Key`) कॉन्फ़िगर करें
5. उपरोक्त अनुरोध प्रारूप से मिलान करने के लिए पेलोड कॉन्फ़िगर करें
