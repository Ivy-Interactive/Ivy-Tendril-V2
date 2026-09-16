import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { getRehypeKatex } from "./math";
import { PlanMarkdown } from "@/components/PlanMarkdown";

/**
 * The on-demand KaTeX load, exercised cold.
 *
 * This lives in a file of its own with exactly one test because the plugin cache in `math.ts` is
 * module-level: vitest isolates modules per test file, but the first mathful render *inside* a file
 * warms the cache for every later one. Nothing else here may touch maths, or the "not loaded yet"
 * half of this test stops being reachable.
 *
 * The sibling maths tests all `await loadRehypeKatex()` up front and assert on typeset output. This
 * one asserts the two things they cannot: that mounting a maths document does not need KaTeX to be
 * there already, and that `useMathReady` brings the typeset render back once the import resolves.
 * Without the second half, KaTeX would simply never appear - see `src/hooks/use-math-ready.ts`.
 */
describe("on-demand KaTeX", () => {
  it("is absent on the first render of a maths document and typesets it once loaded", async () => {
    expect(getRehypeKatex(), "another test in this file warmed the plugin cache").toBeNull();

    const { container } = render(<PlanMarkdown id="w1" content="$$\\frac{a}{b}$$" />);

    // First paint shows the TeX source: the plugin list was built before the import resolved.
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("\\frac{a}{b}");

    await waitFor(() => {
      expect(container.querySelector(".katex")).not.toBeNull();
    });
    expect(container.querySelector(".katex-error")).toBeNull();
  });
});
