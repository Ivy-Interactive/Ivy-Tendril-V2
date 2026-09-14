import { describe, expect, it } from "vitest";
import * as UI from "../src/index";
import * as Diagrams from "../src/diagrams";
import * as Renderers from "../src/renderers";
import * as Tendril from "../src/tendril";

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

  it("should keep PlanMarkdown on the main entrypoint and its sub-components on ./tendril", () => {
    expect(UI.PlanMarkdown).toBeDefined();
    expect(Tendril.DraftMarkdown).toBeDefined();
    expect(Tendril.BlockHandler).toBeDefined();
    expect(Tendril.CodeBlock).toBeDefined();
    expect(Tendril.ImageRenderer).toBeDefined();
    expect(Tendril.AlertBlockquote).toBeDefined();
    expect(Tendril.QuestionsCallout).toBeDefined();
  });
});
