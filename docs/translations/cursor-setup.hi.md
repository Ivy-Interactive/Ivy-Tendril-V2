# Tendril स्किल्स के लिए Cursor सेटअप गाइड

यह गाइड बताती है कि Cursor में Tendril Agent Skills को कैसे इंस्टॉल और कॉन्फ़िगर करें।

## 1. त्वरित इंस्टॉलेशन (Skills CLI)

Skills CLI का उपयोग करके अपने Cursor प्रोजेक्ट में Tendril स्किल्स इंस्टॉल करें:

```bash
# प्रोजेक्ट-स्तरीय इंस्टॉलेशन (.cursor/skills/ में इंस्टॉल करता है)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# ग्लोबल इंस्टॉलेशन (सभी Cursor वर्कस्पेस में उपलब्ध)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Cursor में डायरेक्टरी लेआउट

Cursor निम्नलिखित स्थानों पर स्किल परिभाषाओं को खोजता है:

- **प्रोजेक्ट-स्तरीय**: `.cursor/skills/<skill-name>/SKILL.md`
- **ग्लोबल / उपयोगकर्ता-स्तरीय**: `~/.cursor/skills/<skill-name>/SKILL.md` (macOS/Linux) या `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md` (Windows)

प्रत्येक फ़ोल्डर में शामिल हैं:
- `SKILL.md`: YAML फ़्रंटमैटर के साथ मुख्य निर्देश
- सहायक संदर्भ दस्तावेज़ और स्क्रिप्ट्स

## 3. Cursor नियमों (.cursorrules) के साथ इंटरैक्शन

आप अपने प्रोजेक्ट की `.cursorrules` या `.cursor/rules/*.mdc` फ़ाइलों से Tendril स्किल्स को संदर्भित कर सकते हैं:

```markdown
When debugging failed plans or reviewing changes:
- Reference src/skills/tendril-debug-plan for plan execution diagnosis.
- Run src/skills/tendril-review procedures before finalizing pull requests.
```

## 4. Cursor एजेंट चैट में उपयोग

Cursor की एजेंट चैट विंडो में:
- `@tendril-debug-plan` टाइप करें या एजेंट से उसके निर्देशों का उपयोग करके किसी प्लान का निरीक्षण करने का अनुरोध करें।
- सक्रिय git diff पर `/tendril-review` चलाने के लिए Cursor से कहें।
- एजेंट की उपयुक्तता के अनुसार समस्याओं (issues) को रैंक करने के लिए `/tendrillable` चलाएँ।

## लाइसेंस

Tendril स्किल्स और प्लगइन्स रिपॉजिटरी रूट में मौजूद [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) के तहत लाइसेंस प्राप्त हैं।
