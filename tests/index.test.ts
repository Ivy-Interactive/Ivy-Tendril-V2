import { describe, expect, test } from "vitest";
import * as UI from "../src/index";

describe("index exports", () => {
  test("exports the consolidated prism theme", () => {
    expect(UI.prismTheme).toBeDefined();
    expect(UI.prismTheme.comment).toBeDefined();
    expect(UI.prismTheme["directive"]).toBeDefined(); // superset entry, absent before consolidation
  });
});
