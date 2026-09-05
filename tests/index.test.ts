import { expect, test } from "vite-plus/test";
import * as lib from "../src/index.ts";

test("library exports core foundation symbols", () => {
  expect(typeof lib.cn).toBe("function");
  expect(typeof lib.ThemeProvider).toBe("function");
  expect(typeof lib.useTheme).toBe("function");
  expect(lib.ThemeContext).toBeDefined();
  expect(typeof lib.fn).toBe("function");
});

test("library exports AgentViewer and TendrilProcessViewer components and utilities", () => {
  expect(typeof lib.AgentViewer).toBe("function");
  expect(typeof lib.TendrilProcessViewer).toBe("function");
  expect(typeof lib.ToolUseCard).toBe("function");
  expect(typeof lib.ToolUseGroup).toBe("function");
  expect(typeof lib.ResultSummary).toBe("function");
  expect(typeof lib.AnimatedStatus).toBe("function");
  expect(typeof lib.parseEventWireStream).toBe("function");
  expect(typeof lib.groupToolUseEvents).toBe("function");
  expect(typeof lib.aggregateToolStatus).toBe("function");
  expect(typeof lib.deriveStatus).toBe("function");
  expect(typeof lib.useAutoScroll).toBe("function");
  expect(typeof lib.inputSummary).toBe("function");
});
