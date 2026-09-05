import { describe, expect, it } from "vitest";
import * as UI from "../src/index";
import * as Diagrams from "../src/diagrams";
import * as Renderers from "../src/renderers";

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

  it("should NOT export GraphvizRenderer or MermaidRenderer from renderers entrypoint", () => {
    expect("GraphvizRenderer" in Renderers).toBe(false);
    expect("MermaidRenderer" in Renderers).toBe(false);
    // But other rich content renderers should still be present
    expect(Renderers.MarkdownRenderer).toBeDefined();
    expect(Renderers.JsonRenderer).toBeDefined();
    expect(Renderers.XmlRenderer).toBeDefined();
    expect(Renderers.HtmlRenderer).toBeDefined();
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
