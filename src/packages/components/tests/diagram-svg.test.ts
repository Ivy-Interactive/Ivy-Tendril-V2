import { describe, expect, it } from "vitest";
import { sanitizeSvg, applyFontToSvg } from "../src/lib/diagram";

describe("sanitizeSvg", () => {
  it("strips <script> elements", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    expect(sanitizeSvg(svg)).not.toContain("<script");
  });

  it("strips each element in the dangerous list", () => {
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

    for (const tag of dangerousElements) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg"><${tag}></${tag}></svg>`;
      expect(sanitizeSvg(svg)).not.toContain(`<${tag}`);
    }
  });

  it("strips onload/onclick and arbitrary on* attributes", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" onclick="alert(2)" oncustom="alert(3)" /></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("onload");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("oncustom");
  });

  it("strips href and xlink:href", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)" xlink:href="javascript:alert(2)"></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("href=");
  });

  it("returns an empty svg for unparseable input", () => {
    const result = sanitizeSvg("not xml at all <<<");
    expect(result).toBe("<svg></svg>");
  });
});

describe("applyFontToSvg", () => {
  it("sets font-family on every <text> element", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>a</text><text>b</text></svg>';
    const result = applyFontToSvg(svg);
    const matches = result.match(/font-family="[^"]*"/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("scales font-size by 0.8, preserving the unit suffix", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text font-size="14">a</text></svg>';
    expect(applyFontToSvg(svg)).toContain('font-size="11.20"');

    const svgWithUnit =
      '<svg xmlns="http://www.w3.org/2000/svg"><text font-size="14pt">a</text></svg>';
    expect(applyFontToSvg(svgWithUnit)).toContain('font-size="11.20pt"');
  });
});
