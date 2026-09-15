import { describe, expect, it } from "vitest";
import {
  applyCommentEvent,
  attributeLabel,
  formatChangeRequest,
  readSource,
  type AppComment,
  type ViewerEvent,
} from "../appComments";

/** A `comment` event as `WebViewer` emits it, with only the fields a given test cares about set. */
function commentEvent(fields: Partial<ViewerEvent> & { id: string }): ViewerEvent {
  return { kind: "comment", comment: "note", ...fields };
}

function fold(events: ViewerEvent[]): AppComment[] {
  return events.reduce(applyCommentEvent, [] as AppComment[]);
}

describe("applyCommentEvent", () => {
  it("appends a comment, numbering it by position", () => {
    const comments = fold([
      commentEvent({ id: "m1", comment: "first", tag: "button", selector: "#a" }),
      commentEvent({ id: "m2", comment: "second" }),
    ]);

    expect(comments.map((c) => [c.number, c.id, c.comment])).toEqual([
      [1, "m1", "first"],
      [2, "m2", "second"],
    ]);
    expect(comments[0].tag).toBe("button");
    expect(comments[0].selector).toBe("#a");
  });

  it("edits a comment in place, leaving its number and the others alone", () => {
    const comments = fold([
      commentEvent({ id: "m1", comment: "first" }),
      commentEvent({ id: "m2", comment: "second" }),
      { kind: "comment-edit", id: "m1", comment: "first, revised" },
    ]);

    expect(comments.map((c) => [c.number, c.comment])).toEqual([
      [1, "first, revised"],
      [2, "second"],
    ]);
  });

  it("renumbers the survivors on a delete", () => {
    const comments = fold([
      commentEvent({ id: "m1", comment: "first" }),
      commentEvent({ id: "m2", comment: "second" }),
      commentEvent({ id: "m3", comment: "third" }),
      { kind: "comment-delete", id: "m1" },
    ]);

    expect(comments.map((c) => [c.number, c.comment])).toEqual([
      [1, "second"],
      [2, "third"],
    ]);
  });

  it("numbers a comment added after a delete from the current length, not the high-water mark", () => {
    const comments = fold([
      commentEvent({ id: "m1" }),
      commentEvent({ id: "m2" }),
      { kind: "comment-delete", id: "m2" },
      commentEvent({ id: "m3" }),
    ]);

    expect(comments.map((c) => c.number)).toEqual([1, 2]);
  });

  it("ignores events that are not comment events, and comment events with no id", () => {
    const before = fold([commentEvent({ id: "m1" })]);

    expect(applyCommentEvent(before, { kind: "navigated", url: "https://x/" })).toBe(before);
    expect(applyCommentEvent(before, { kind: "console", text: "hi" })).toBe(before);
    expect(applyCommentEvent(before, { kind: "comment", comment: "no id" })).toBe(before);
    expect(applyCommentEvent(before, { kind: "comment-delete" })).toBe(before);
    expect(applyCommentEvent(before, {})).toBe(before);
  });

  it("ignores an edit or a delete naming a comment it does not hold", () => {
    const before = fold([commentEvent({ id: "m1", comment: "first" })]);

    expect(applyCommentEvent(before, { kind: "comment-edit", id: "gone", comment: "x" })).toEqual(
      before,
    );
    expect(applyCommentEvent(before, { kind: "comment-delete", id: "gone" })).toEqual(before);
  });
});

describe("readSource", () => {
  it("reads file, line, provenance, confidence and the owner chain", () => {
    const source = readSource(
      JSON.stringify({
        source: { file: "src/components/SaveButton.tsx", line: 42 },
        provenance: "owner-stack",
        confidence: "high",
        ownerChain: [{ name: "SettingsPage" }, { name: "SaveButton" }],
      }),
    );

    expect(source).toEqual({
      label: "src/components/SaveButton.tsx:42",
      provenance: "owner-stack",
      confidence: "high",
      componentPath: "SettingsPage > SaveButton",
    });
  });

  it('drops the line when there is none, and treats "none" as no provenance', () => {
    const source = readSource(
      JSON.stringify({ source: { file: "src/App.tsx" }, provenance: "none", confidence: "none" }),
    );

    expect(source.label).toBe("src/App.tsx");
    expect(source.provenance).toBeNull();
    expect(source.confidence).toBeNull();
  });

  it("returns nothing for absent, unparseable or non-object payloads", () => {
    const empty = { label: null, provenance: null, confidence: null, componentPath: null };

    expect(readSource(null)).toEqual(empty);
    expect(readSource("")).toEqual(empty);
    expect(readSource("{not json")).toEqual(empty);
    expect(readSource("[1,2]")).toEqual(empty);
    expect(readSource("{}")).toEqual(empty);
  });
});

describe("attributeLabel", () => {
  it("prints the identifying attributes, most stable first, capped at three", () => {
    expect(
      attributeLabel(
        JSON.stringify({
          href: "/buy",
          "aria-label": "Buy now",
          id: "buy-btn",
          "data-testid": "buy-now-button",
        }),
      ),
    ).toBe('data-testid="buy-now-button" id="buy-btn" aria-label="Buy now"');
  });

  it("returns null when nothing identifying is present or the payload is unusable", () => {
    expect(attributeLabel(JSON.stringify({ class: "btn", style: "color:red" }))).toBeNull();
    expect(attributeLabel("{not json")).toBeNull();
    expect(attributeLabel(null)).toBeNull();
  });
});

describe("formatChangeRequest", () => {
  const resolved = commentEvent({
    id: "m1",
    comment: "  Make this the primary variant  ",
    tag: "button",
    text: "  Save  ",
    selector: "#save",
    url: "https://app.test/settings",
    device: "Tablet",
    attrsJson: JSON.stringify({ "data-testid": "save-button" }),
    debugJson: JSON.stringify({
      source: { file: "src/ui/Button.tsx", line: 17 },
      provenance: "owner-stack",
      confidence: "high",
      ownerChain: [{ name: "SettingsPage" }, { name: "SaveButton" }],
    }),
  });

  const unresolved = commentEvent({
    id: "m2",
    comment: "This is cut off",
    tag: "div",
    selector: "main > div:nth-child(3)",
    url: "https://app.test/dashboard",
  });

  it("groups by page, in the order the pages were first commented on", () => {
    const text = formatChangeRequest("https://app.test/", fold([resolved, unresolved]));

    expect(text.split("\n").filter((line) => line.startsWith("## "))).toEqual([
      "## https://app.test/settings",
      "## https://app.test/dashboard",
    ]);
  });

  it("falls back to the viewer's URL for a comment that carries no page", () => {
    const text = formatChangeRequest("https://app.test/", fold([commentEvent({ id: "m1" })]));

    expect(text).toContain("## https://app.test/");
  });

  it("leads with a qualified source location and the component path", () => {
    const text = formatChangeRequest("https://app.test/", fold([resolved]));

    expect(text).toContain("- **1. <button>** “Save”");
    expect(text).toContain("  Make this the primary variant");
    expect(text).toContain("  source: `src/ui/Button.tsx:17` (high, owner-stack)");
    expect(text).toContain("  component: SettingsPage > SaveButton");
    expect(text).toContain('  attributes: data-testid="save-button"');
    expect(text).toContain("  viewport: Tablet");
  });

  it("omits the parenthetical when neither confidence nor provenance is known", () => {
    const bare = commentEvent({
      id: "m1",
      debugJson: JSON.stringify({ source: { file: "src/App.tsx", line: 3 } }),
    });

    expect(formatChangeRequest("https://app.test/", fold([bare])).split("\n")).toContain(
      "  source: `src/App.tsx:3`",
    );
  });

  it("prints the selector only when no source resolved", () => {
    const both = formatChangeRequest("https://app.test/", fold([resolved, unresolved]));

    expect(both).toContain("  selector: `main > div:nth-child(3)`");
    expect(both).not.toContain("  selector: `#save`");
  });

  it("names the element generically when the tag is unknown, and omits an empty quote", () => {
    const text = formatChangeRequest("https://app.test/", fold([commentEvent({ id: "m1" })]));

    expect(text.split("\n")).toContain("- **1. element**");
  });

  it("explains how to read a source location, so a shared primitive is not edited blind", () => {
    const text = formatChangeRequest("https://app.test/", fold([resolved]));

    expect(text).toContain("Feedback from reviewing the running app at https://app.test/");
    expect(text).toContain("the primitive rather than the thing being complained about");
    expect(text).toContain("not marked high confidence as a lead to verify");
  });
});
