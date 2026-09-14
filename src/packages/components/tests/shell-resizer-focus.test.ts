import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";

describe("Sidebar Resizer Focus-Visible Styling", () => {
  const shellCssPath = resolve(__dirname, "..", "src/components/Shell/shell.css");
  const shellCss = readFileSync(shellCssPath, "utf-8");

  test("declares a .tsh-sidebar-resizer:focus-visible rule", () => {
    expect(shellCss).toContain(".tsh-sidebar-resizer:focus-visible");
  });

  test("the focus-visible rule declares an outline", () => {
    const match = shellCss.match(/\.tsh-sidebar-resizer:focus-visible\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(/outline:/);
  });

  test("uses :focus-visible and not a bare :focus selector for the resizer", () => {
    expect(shellCss).not.toMatch(/\.tsh-sidebar-resizer:focus\s*[,{]/);
  });
});
