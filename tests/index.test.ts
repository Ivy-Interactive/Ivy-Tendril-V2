import { expect, test } from "vite-plus/test";
import * as UI from "../src/index.ts";
import {
  PlanMarkdown,
  PlanDiffView,
  ContentInput,
  BadgeSelect,
  SortableVerificationList,
} from "../src/index.ts";

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

test("exports PlanMarkdown and PlanDiffView", () => {
  expect(PlanMarkdown).toBeDefined();
  expect(PlanDiffView).toBeDefined();
});

test("exports components", () => {
  expect(ContentInput).toBeDefined();
  expect(BadgeSelect).toBeDefined();
  expect(SortableVerificationList).toBeDefined();
});

test("library exports AgentViewer and TendrilProcessViewer components and utilities", () => {
  expect(typeof UI.AgentViewer).toBe("function");
  expect(typeof UI.TendrilProcessViewer).toBe("function");
  expect(typeof UI.ToolUseCard).toBe("function");
  expect(typeof UI.ToolUseGroup).toBe("function");
  expect(typeof UI.ResultSummary).toBe("function");
  expect(typeof UI.AnimatedStatus).toBe("function");
  expect(typeof UI.parseEventWireStream).toBe("function");
  expect(typeof UI.groupToolUseEvents).toBe("function");
  expect(typeof UI.aggregateToolStatus).toBe("function");
  expect(typeof UI.deriveStatus).toBe("function");
  expect(typeof UI.useAutoScroll).toBe("function");
  expect(typeof UI.inputSummary).toBe("function");
});
