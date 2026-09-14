import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

describe("globals.css contrast adaptation utility", () => {
  const globalsCssPath = resolve(__dirname, "..", "src/styles/globals.css");
  const css = readFileSync(globalsCssPath, "utf-8");

  it("adapts .text-muted-foreground and .text-muted to currentColor inside primary, secondary, and destructive containers", () => {
    expect(css).toMatch(
      /:where\([^)]*\.bg-primary[^)]*\.bg-secondary[^)]*\.bg-destructive[^)]*\)\s*:is\(\.text-muted-foreground,\s*\.text-muted\)\s*\{[^}]*color:\s*currentColor;/,
    );
  });
});
