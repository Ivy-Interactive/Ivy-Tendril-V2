import { expect, test } from "vite-plus/test";
import * as UI from "../src/index.ts";

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
