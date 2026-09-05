import { expect, test } from "vite-plus/test";
import { fn, PlanMarkdown, PlanDiffView } from "../src/index.ts";

test("fn", () => {
  expect(fn()).toBe("Hello, tsdown!");
});

test("exports PlanMarkdown and PlanDiffView", () => {
  expect(PlanMarkdown).toBeDefined();
  expect(PlanDiffView).toBeDefined();
});
