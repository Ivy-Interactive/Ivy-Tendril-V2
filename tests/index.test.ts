import { expect, test } from "vite-plus/test";
import * as lib from "../src/index.ts";

test("library exports core foundation symbols", () => {
  expect(typeof lib.cn).toBe("function");
  expect(typeof lib.ThemeProvider).toBe("function");
  expect(typeof lib.useTheme).toBe("function");
  expect(lib.ThemeContext).toBeDefined();
  expect(typeof lib.fn).toBe("function");
});
