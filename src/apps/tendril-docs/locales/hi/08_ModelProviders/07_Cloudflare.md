---
title: क्लाउडफ्लेयर (Cloudflare)
description: मॉडल प्रदाता के रूप में Cloudflare Workers AI का उपयोग करें और
  Workers के निर्माण एवं परिनियोजन (डिप्लॉयमेंट) के लिए Cloudflare MCP सर्वर से
  कनेक्ट करें।
icon: Globe
searchHints:
  - क्लाउडफ्लेयर
  - वर्कर्स एआई
  - सीएफ (cf)
  - एज
  - क्लाउडफ्लेयर्ड
  - टनल
---

# क्लाउडफ्लेयर (Cloudflare)

[Cloudflare](https://www.cloudflare.com) [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) के माध्यम से वैश्विक एज कंप्यूट और सर्वरलेस AI इन्फरेंस प्रदान करता है। डेवलपर्स फुल-स्टैक [Cloudflare Workers](https://workers.cloudflare.com) विकास के लिए आधिकारिक Cloudflare [मॉडल कॉन्टेक्स्ट प्रोटोकॉल (MCP)](../09_Advanced/03_MCP.md) स्किल्स के साथ जोड़ते हुए, एज पर तेज़ और लागत प्रभावी ओपन-वेट मॉडल (जैसे [Meta का Llama](https://llama.meta.com)) चला सकते हैं।

## OpenCode के माध्यम से सेटअप

1. टर्मिनल या Tendril के एम्बेडेड PTY के माध्यम से [OpenCode](https://opencode.ai) लॉन्च करें:
   ```bash
   opencode
   ```
   `/connect` टाइप करें और **Cloudflare** चुनें।
2. संकेत मिलने पर ब्राउज़र प्रमाणीकरण पूर्ण करें।
3. `/models` के साथ एक सक्रिय मॉडल चुनें।

## Cloudflare MCP स्किल्स (वैकल्पिक)

आप अपने [कोडिंग एजेंट](../06_CodingAgents/_Index.md) को Cloudflare Workers, KV, D1 डेटाबेस और डिप्लॉयमेंट पर सीधा नियंत्रण प्रदान करने के लिए Cloudflare MCP सर्वर जोड़ सकते हैं (देखें [स्किल्स](../06_CodingAgents/00_Skills.md)):

```bash
npx skills add https://github.com/cloudflare/skills
```

एक बार इंस्टॉल हो जाने पर, Tendril योजनाओं (plans) को निष्पादित करने वाले कोडिंग एजेंट स्वायत्त रूप से बाइंडिंग बना सकते हैं, वर्कर स्क्रिप्ट डिप्लॉय कर सकते हैं और रीयल-टाइम एज लॉग्स का निरीक्षण कर सकते हैं।

## Tendril के साथ उपयोग करना

1. Tendril खोलें और **Settings > Coding Agent** पर जाएं।
2. अपने कोडिंग एजेंट को **OpenCode** पर सेट करें (देखें [OpenCode एजेंट](../06_CodingAgents/04_OpenCode.md))।
3. Tendril योजना के कार्यों को OpenCode पर रूट करता है, जो Cloudflare Workers AI को कॉल करता है।

आप `~/.tendril/config.yaml` में इसके [OpenAI](https://openai.com)-संगत एंडपॉइंट के माध्यम से Cloudflare Workers AI को भी लक्षित कर सकते हैं (देखें [कॉन्फ़िगरेशन सेटअप](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-cloudflare-api-token"
      OPENAI_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    profiles:
      - name: deep
        model: "@cf/meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: medium
      - name: quick
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: low
```

> [!NOTE]
> Workers AI मॉडल इन्फरेंस के अलावा, Tendril v2 टीम के साथियों के साथ सुरक्षित, केवल-पढ़ने योग्य (read-only) योजना साझा करने के लिए Cloudflare Quick Tunnels (`cloudflared`) को मूल रूप से एकीकृत करता है। टनल साझाकरण **Settings > Security & Tunneling** के अंतर्गत अलग से कॉन्फ़िगर किया गया है।

## लिंक्स

- [मॉडल प्रदाता](_Index.md)
- [कोडिंग एजेंट्स](../06_CodingAgents/_Index.md)
- [Cloudflare Workers AI दस्तावेज़ीकरण](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare + OpenCode गाइड](https://developers.cloudflare.com/agent-setup/opencode/)
