import { describe, expect, it } from "vite-plus/test";
import { cn } from "../src/lib/utils.ts";

describe("cn utility", () => {
  it("merges standard class strings", () => {
    expect(cn("px-4", "py-2", "text-sm")).toBe("px-4 py-2 text-sm");
  });

  it("handles conditionals, falsy, and undefined values", () => {
    const isHidden = false;
    const isVisible = true;
    expect(cn("base", isHidden && "hidden", null, undefined, isVisible && "visible")).toBe(
      "base visible",
    );
  });

  it("properly resolves conflicting Tailwind utility classes", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("bg-white", "bg-black")).toBe("bg-black");
  });
});
