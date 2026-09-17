import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";
import { readCssInlined } from "../../../../tests/read-css.ts";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "../../../styles/globals.css");
const css = readCssInlined(cssPath);

describe("blade animations in globals.css", () => {
  it("defines the horizontal slide keyframes", () => {
    expect(css).toContain("@keyframes bladeSlideIn");
    expect(css).toContain("@keyframes bladeSlideOut");
  });

  it("exposes enter and exit utilities that use them", () => {
    expect(css).toContain(".blade-animate-enter");
    expect(css).toContain("animation: bladeSlideIn 200ms ease-out;");
    expect(css).toContain(".blade-animate-exit");
    expect(css).toContain("animation: bladeSlideOut 200ms ease-out forwards;");
  });

  it("disables both utilities under prefers-reduced-motion", () => {
    const guard = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(guard).toContain(".blade-animate-enter");
    expect(guard).toContain(".blade-animate-exit");
    expect(guard).toContain("animation: none;");
  });
});
