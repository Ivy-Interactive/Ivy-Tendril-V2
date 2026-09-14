import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import setup from "./global-setup.ts";

describe("Vitest global-setup", () => {
  it("exports a setup function", () => {
    expect(typeof setup).toBe("function");
  });

  it("does not re-build if dist/tendril.mjs already exists", () => {
    const distTendril = resolve(import.meta.dirname, "../dist/tendril.mjs");
    expect(existsSync(distTendril)).toBe(true);

    // Running setup when dist exists should be a fast no-op
    expect(() => setup()).not.toThrow();
  });
});
