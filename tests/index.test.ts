import { expect, test } from "vite-plus/test";
import * as UI from "../src/index.ts";
import { ContentInput, BadgeSelect, SortableVerificationList } from "../src/index.ts";

test("library exports core foundation symbols", () => {
  expect(typeof UI.cn).toBe("function");
  expect(typeof UI.ThemeProvider).toBe("function");
  expect(typeof UI.useTheme).toBe("function");
  expect(UI.ThemeContext).toBeDefined();
  expect(typeof UI.fn).toBe("function");
});

test("exports core primitives", () => {
  expect(UI.Button).toBeDefined();
  expect(UI.Checkbox).toBeDefined();
  expect(UI.Switch).toBeDefined();
  expect(UI.Tabs).toBeDefined();
  expect(UI.Accordion).toBeDefined();
  expect(UI.Dialog).toBeDefined();
  expect(UI.Slider).toBeDefined();
  expect(UI.Toggle).toBeDefined();
  expect(UI.toast).toBeDefined();
});

test("exports components", () => {
  expect(ContentInput).toBeDefined();
  expect(BadgeSelect).toBeDefined();
  expect(SortableVerificationList).toBeDefined();
});
