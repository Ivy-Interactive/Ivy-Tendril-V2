import { expect, test } from "vite-plus/test";
import {
  fn,
  TendrilDashboard,
  ActivityGrid,
  PillBars,
  TrendChart,
  HoverTip,
  WebViewer,
} from "../src/index.ts";

test("fn", () => {
  expect(fn()).toBe("Hello, tsdown!");
});

test("exports components", () => {
  expect(TendrilDashboard).toBeDefined();
  expect(ActivityGrid).toBeDefined();
  expect(PillBars).toBeDefined();
  expect(TrendChart).toBeDefined();
  expect(HoverTip).toBeDefined();
  expect(WebViewer).toBeDefined();
});
