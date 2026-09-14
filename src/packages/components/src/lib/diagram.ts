import { logger } from "./logger";

/**
 * Sanitize SVG content to prevent XSS attacks.
 * Removes dangerous elements and attributes that could execute scripts.
 */
export const sanitizeSvg = (svg: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");

  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    logger.warn("SVG parsing error, falling back to empty content");
    return "<svg></svg>";
  }

  const svgElement = doc.documentElement;

  const dangerousElements = [
    "script",
    "object",
    "embed",
    "link",
    "meta",
    "iframe",
    "frame",
    "frameset",
    "form",
    "input",
    "button",
    "textarea",
    "select",
  ];

  dangerousElements.forEach((tagName) => {
    svgElement.querySelectorAll(tagName).forEach((el) => el.remove());
  });

  const walker = document.createTreeWalker(svgElement, NodeFilter.SHOW_ELEMENT, null);

  const attributesToRemove = [
    "onload",
    "onerror",
    "onclick",
    "onmouseover",
    "onfocus",
    "onblur",
    "onchange",
    "onsubmit",
    "onreset",
    "onselect",
    "onunload",
    "href",
    "xlink:href", // Remove links that could navigate away
  ];

  let node;
  while ((node = walker.nextNode())) {
    const element = node as Element;
    attributesToRemove.forEach((attr) => {
      if (element.hasAttribute(attr)) {
        element.removeAttribute(attr);
      }
    });

    // Remove any attribute that starts with 'on' (event handlers)
    Array.from(element.attributes).forEach((attr) => {
      if (attr.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attr.name);
      }
    });
  }

  return new XMLSerializer().serializeToString(svgElement);
};

/**
 * Apply Ivy system font to all text elements in SVG.
 * Graphviz WASM renders text with "Times New Roman" by default.
 * We resolve --font-sans and set it on all <text> elements.
 */
export const applyFontToSvg = (svgString: string): string => {
  let fontSans = "Geist, sans-serif";
  if (typeof document !== "undefined") {
    try {
      const resolved = getComputedStyle(document.documentElement)
        .getPropertyValue("--font-sans")
        .trim();
      if (resolved) fontSans = resolved;
    } catch {
      // Use fallback
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgElement = doc.documentElement;

  svgElement.querySelectorAll("text").forEach((el) => {
    el.setAttribute("font-family", fontSans);

    const fontSize = el.getAttribute("font-size");
    if (fontSize) {
      const match = fontSize.match(/^([\d.]+)(.*)$/);
      if (match) {
        const value = parseFloat(match[1]);
        const unit = match[2] || "";
        const scaledValue = (value * 0.8).toFixed(2);
        el.setAttribute("font-size", `${scaledValue}${unit}`);
      }
    }
  });

  return new XMLSerializer().serializeToString(svgElement);
};

/** Renders Mermaid diagram source to sanitized SVG markup. */
export const renderMermaid = async (content: string): Promise<string> => {
  const mermaid = (await import("mermaid")).default;

  const computedStyle = getComputedStyle(document.documentElement);
  const getCSSVariable = (variable: string) => computedStyle.getPropertyValue(variable).trim();

  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      // Use hex colors from index.css CSS variables
      primaryColor: getCSSVariable("--primary"),
      primaryTextColor: getCSSVariable("--foreground"),
      primaryBorderColor: getCSSVariable("--foreground"),
      lineColor: getCSSVariable("--foreground"),
      sectionBkgColor: getCSSVariable("--muted"),
      altSectionBkgColor: getCSSVariable("--background"),
      gridColor: getCSSVariable("--border"),
      secondaryColor: getCSSVariable("--secondary"),
      tertiaryColor: getCSSVariable("--muted"),
      background: getCSSVariable("--background"),
      mainBkg: getCSSVariable("--background"),
      secondBkg: getCSSVariable("--muted"),
      tertiaryBkg: getCSSVariable("--accent"),
    },
    fontFamily: "inherit",
    securityLevel: "strict",
    htmlLabels: false, // Prevent HTML injection in diagram labels
    suppressErrorRendering: true, // Prevent Mermaid from adding error divs to the page
  });

  const id = `mermaid-${crypto.randomUUID()}`;
  const { svg } = await mermaid.render(id, content.trim());
  return sanitizeSvg(svg);
};

/** Renders Graphviz DOT source to sanitized, font-adjusted SVG markup. */
export const renderGraphviz = async (content: string): Promise<string> => {
  const { Graphviz } = await import("@hpcc-js/wasm-graphviz");
  const graphviz = await Graphviz.load();
  const svg = graphviz.dot(content.trim());
  return sanitizeSvg(applyFontToSvg(svg));
};
