import { describe, expect, it } from "vitest";
import * as UI from "../src/index";
import * as Diagrams from "../src/diagrams";

describe("diagrams export", () => {
  it("should export GraphvizRenderer and MermaidRenderer from diagrams entrypoint", () => {
    expect(Diagrams.GraphvizRenderer).toBeDefined();
    expect(Diagrams.MermaidRenderer).toBeDefined();
    expect(typeof Diagrams.GraphvizRenderer).toBe("object");
    expect(typeof Diagrams.MermaidRenderer).toBe("object");
  });

  it("should NOT export GraphvizRenderer or MermaidRenderer from main entrypoint", () => {
    expect("GraphvizRenderer" in UI).toBe(false);
    expect("MermaidRenderer" in UI).toBe(false);
  });

  it("should still export PlanMarkdown and related utilities from main entrypoint", () => {
    expect(UI.PlanMarkdown).toBeDefined();
    expect(UI.DraftMarkdown).toBeDefined();
    expect(UI.BlockHandler).toBeDefined();
    expect(UI.CodeBlock).toBeDefined();
    expect(UI.ImageRenderer).toBeDefined();
    expect(UI.AlertBlockquote).toBeDefined();
    expect(UI.QuestionsCallout).toBeDefined();
  });
});
