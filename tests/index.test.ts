import { expect, test } from "vite-plus/test";
import { fn, ContentInput, BadgeSelect, SortableVerificationList } from "../src/index.ts";

test("fn", () => {
  expect(fn()).toBe("Hello, tsdown!");
});

test("exports components", () => {
  expect(ContentInput).toBeDefined();
  expect(BadgeSelect).toBeDefined();
  expect(SortableVerificationList).toBeDefined();
});
