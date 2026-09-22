# Tendril स्किल्स के लिए Google Antigravity सेटअप गाइड

यह गाइड Google Antigravity CLI (`agy`) और Antigravity IDE के साथ Tendril स्किल्स को इंस्टॉल और उपयोग करने के बारे में जानकारी प्रदान करती है।

## 1. Antigravity CLI इंस्टॉलेशन

Tendril `.agents/plugins/marketplace.json` पर एक Antigravity प्लगइन मेनिफ़ेस्ट प्रदान करता है।

### रिमोट Git रिपॉजिटरी से इंस्टॉल करें
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### स्थानीय रिपॉजिटरी चेकआउट से इंस्टॉल करें
स्थानीय विकास के दौरान या Ivy-Tendril-V2 चेकआउट के भीतर:
```bash
agy plugin install ./
```

## 2. प्लगइन सत्यापन और खोज

सत्यापित करें कि प्लगइन और उससे संबंधित स्किल्स लोड हो गई हैं:

```bash
# इंस्टॉल किए गए प्लगइन्स की सूची देखें
agy plugin list

# उपलब्ध स्किल्स सत्यापित करें
agy skill list
```

आपको बंडल की गई Tendril स्किल्स दिखाई देंगी:
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. Antigravity में स्किल आह्वान (Invocation)

किसी भी इंटरैक्टिव Antigravity एजेंट सत्र या स्वचालित स्क्रिप्ट में:

- Antigravity से किसी प्लान को डिबग करने का अनुरोध करें:
  ```
  Use tendril-debug-plan to investigate plan 00516
  ```
- लंबित वर्कट्री diffs की समीक्षा करें:
  ```
  Run tendril-review on the current changes
  ```
- बैकलाग की संभावित समस्याओं (issues) को प्राथमिकता दें:
  ```
  Run tendrillable on https://github.com/ivy-interactive/ivy-tendril-v2 5
  ```

## 4. Antigravity IDE एकीकरण

Antigravity IDE के भीतर काम करते समय:
1. आपके वर्कस्पेस की रूट डायरेक्टरी `.agents/skills/` में रखी गई स्किल्स स्वचालित रूप से इंडेक्स हो जाती हैं।
2. Ivy Tendril एक्सटेंशन को Antigravity IDE में लिंक करने के लिए:
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. Antigravity IDE को पुनः लोड करें (`Cmd+Shift+P` -> `Developer: Reload Window`)।

## लाइसेंस

Tendril स्किल्स और प्लगइन्स रिपॉजिटरी रूट में मौजूद [Functional Source License (FSL-1.1-ALv2)](../LICENSE) के तहत लाइसेंस प्राप्त हैं।
