# Tendril स्किल्स के लिए Visual Studio Code सेटअप गाइड

यह गाइड बताती है कि Visual Studio Code में GitHub Copilot और अन्य AI एजेंट एक्सटेंशन के साथ Tendril Agent Skills को कैसे इंस्टॉल, कॉन्फ़िगर और उपयोग करें।

## 1. त्वरित इंस्टॉलेशन (Skills CLI)

VS Code में GitHub Copilot के लिए Tendril स्किल्स इंस्टॉल करने का सबसे आसान तरीका ओपन एजेंट स्किल्स CLI का उपयोग करना है:

```bash
# प्रोजेक्ट-स्तरीय इंस्टॉलेशन (.agents/skills/ या .github/skills/ में इंस्टॉल करता है)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# ग्लोबल इंस्टॉलेशन (सभी VS Code वर्कस्पेस में उपलब्ध)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

पूरे पैकेज के बजाय विशिष्ट व्यक्तिगत स्किल्स इंस्टॉल करने के लिए:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. मैन्युअल इंस्टॉलेशन पथ (Manual Installation Paths)

यदि आप CLI के बिना मैन्युअल रूप से स्किल फ़ोल्डर्स रखना पसंद करते हैं:

- **वर्कस्पेस रिपॉजिटरी (टीमों के लिए अनुशंसित)**:
  अपने वर्कस्पेस रूट पर `.agents/skills/<skill-name>` या `.github/skills/<skill-name>` में स्किल्स कॉपी करें।
- **उपयोगकर्ता प्रोफ़ाइल (सभी प्रोजेक्ट्स के लिए ग्लोबल)**:
  स्किल्स को `~/.copilot/skills/<skill-name>` (macOS/Linux) या `%USERPROFILE%\.copilot\skills\<skill-name>` (Windows) में कॉपी करें।

सुनिश्चित करें कि प्रत्येक स्किल फ़ोल्डर में उसका `SKILL.md` विनिर्देश और कोई भी संलग्न `references/` या `scripts/` डायरेक्टरी शामिल हो।

## 3. GitHub Copilot Chat में स्किल्स का उपयोग

एक बार इंस्टॉल होने के बाद, GitHub Copilot स्वचालित रूप से स्किल्स की खोज कर लेता है:

1. VS Code में Copilot Chat खोलें (`Ctrl+Alt+I` / `Cmd+Ctrl+I`)।
2. लोड की गई स्किल्स और उनके विवरण देखने के लिए `/skills` टाइप करें।
3. किसी भी Tendril स्किल को सीधे कमांड के रूप में इनवोक करें:
   - `/tendril-debug-plan <plan-id>`: किसी प्लान के लिए निष्पादन लॉग, समयरेखा और सत्यापन का निरीक्षण करें।
   - `/tendril-debug-job <job-id>`: जॉब आर्टिफ़ैक्ट्स, एजेंट लॉग और रॉ इवेंट्स का विश्लेषण करें।
   - `/tendril-review`: संशोधित फ़ाइलों पर व्यापक पोस्ट-चेंज कोड और परीक्षण समीक्षा चलाएँ।
   - `/tendrillable <url>`: स्वायत्त एजेंट निष्पादन के लिए GitHub समस्याओं का मूल्यांकन करें।

## 4. अन्य VS Code AI एक्सटेंशन के साथ एकीकरण

Tendril स्किल्स ओपन एजेंट स्किल्स मानक का पालन करती हैं और तीसरे पक्ष के VS Code एक्सटेंशन के साथ निर्बाध रूप से काम करती हैं:

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
स्किल्स `.cline/skills/` या ग्लोबल Cline कॉन्फ़िगरेशन डायरेक्टरी में लिखी जाती हैं।

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
स्किल्स आपकी `.continue/skills/` डायरेक्टरी में इंस्टॉल होती हैं और प्रॉम्प्ट संदर्भ में संदर्भित की जा सकती हैं।

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
कस्टम सिस्टम मोड और टास्क निष्पादन के लिए `.roo/skills/` में इंस्टॉल किया जाता है।

## 5. आधिकारिक Ivy Tendril VS Code एक्सटेंशन के साथ संयोजन

एक एकीकृत विकास वर्कफ़्लो के लिए, आधिकारिक [Ivy Tendril VS Code Extension](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) इंस्टॉल करें:

- **प्लान डैशबोर्ड**: साइडबार से सीधे प्लान्स ब्राउज़ करें, समीक्षा करें और ट्रिगर करें।
- **वर्कट्री नेविगेटर**: एक क्लिक से अलग किए गए निष्पादन वर्कट्री में जाएँ।
- **सर्वर नियंत्रण**: बैकग्राउंड Tendril सर्वर प्रक्रियाओं को प्रारंभ, बंद और निरीक्षण करें।

VS Code एक्सटेंशन के साथ Tendril स्किल्स को संयोजित करने से आपको स्वायत्त कोडिंग एजेंट ऑर्केस्ट्रेशन के लिए एक पूर्ण नियंत्रण केंद्र मिलता है।

## लाइसेंस

Tendril स्किल्स और प्लगइन्स रिपॉजिटरी रूट में मौजूद [Functional Source License (FSL-1.1-ALv2)](../LICENSE) के तहत लाइसेंस प्राप्त हैं।
