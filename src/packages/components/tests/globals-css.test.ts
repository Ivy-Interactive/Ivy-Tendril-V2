import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readCssInlined } from "./read-css.ts";

describe("globals.css contrast adaptation utility", () => {
  const globalsCssPath = resolve(__dirname, "..", "src/styles/globals.css");
  const css = readCssInlined(globalsCssPath);

  it("adapts .text-muted-foreground and .text-muted to currentColor inside primary, secondary, and destructive containers", () => {
    expect(css).toMatch(
      /:where\([^)]*\.bg-primary[^)]*\.bg-secondary[^)]*\.bg-destructive[^)]*\)\s*:is\(\.text-muted-foreground,\s*\.text-muted\)\s*\{[^}]*color:\s*currentColor;/,
    );
  });
});
