import { render, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { ErrorDisplay } from "../src/components/ErrorDisplay";

describe("ErrorDisplay", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText,
      },
      writable: true,
      configurable: true,
    });
  });

  it("renders error title, message, and formatted stack trace", () => {
    const { container } = render(
      <ErrorDisplay
        title="NullReferenceException"
        message="Object reference not set"
        stackTrace="at Foo.Bar() in Foo.cs:line 1"
      />,
    );
    expect(container.textContent).toContain("NullReferenceException");
    expect(container.textContent).toContain("Object reference not set");
    expect(container.textContent).toContain("Foo.Bar()");
  });

  it("copies details to clipboard when button is clicked", async () => {
    const { container } = render(
      <ErrorDisplay title="CustomException" message="Detailed error message" />,
    );
    const copyButton = container.querySelector("button")!;
    expect(copyButton).not.toBeNull();

    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(writeText).toHaveBeenCalled();
  });

  /** Regression: the Copy Details button rendered on top of the stack trace. The trace section was
   * a plain block, so its scroller had no definite height to resolve `flex-1` against, sized to its
   * content (a 470px box in a 148px section) and spilled over the button's row. jsdom does no
   * layout, so these assert the structure that makes the overlap impossible rather than pixels. */
  describe("narrow-width layout", () => {
    const traceScroller = (container: HTMLElement) =>
      container.querySelector<HTMLElement>("[tabindex='0']")!;

    it("bounds the stack-trace scroller inside a flex column instead of letting it size to content", () => {
      const { container } = render(<ErrorDisplay title="T" message="M" stackTrace="at Foo()" />);
      const scroller = traceScroller(container);
      const section = scroller.parentElement!;

      // Without these the scroller cannot be bounded, and an unbounded box never scrolls.
      expect(section.className).toContain("flex-col");
      expect(section.className).toContain("min-h-0");
      expect(scroller.className).toContain("flex-1");
      expect(scroller.className).toContain("min-h-0");
      expect(scroller.className).toContain("overflow-auto");
    });

    it("keeps the copy button in its own row, a sibling section below the trace", () => {
      const { container } = render(<ErrorDisplay title="T" message="M" stackTrace="at Foo()" />);
      const scroller = traceScroller(container);
      const button = container.querySelector("button")!;
      const buttonRow = button.parentElement!;
      const traceSection = scroller.parentElement!;

      // Siblings in the same column, button strictly after the trace: no overlap is representable.
      expect(buttonRow.parentElement).toBe(traceSection.parentElement);
      expect(buttonRow).not.toBe(traceSection);
      expect(
        traceSection.compareDocumentPosition(buttonRow) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // `shrink-0` keeps the row at its natural height instead of being squeezed away by the trace.
      expect(buttonRow.className).toContain("shrink-0");
      expect(scroller.contains(button)).toBe(false);
    });

    it("lets a long single-token message and title wrap instead of widening the card", () => {
      const longToken = `System.AggregateException_${"x".repeat(240)}`;
      const { container } = render(<ErrorDisplay title={longToken} message={longToken} />);

      const paragraphs = [...container.querySelectorAll("p")];
      expect(paragraphs).toHaveLength(2);
      // An unbroken token has no wrap opportunity of its own; break-words supplies one.
      for (const paragraph of paragraphs) {
        expect(paragraph.className).toContain("break-words");
      }
      expect(container.firstElementChild?.className).toContain("min-w-0");
    });

    it("wraps a long file path and a newline-free trace inside the scroller", () => {
      const longPath = `at X() in /a/${"segment-".repeat(40)}File.cs:line 9`;
      const { container } = render(<ErrorDisplay message="M" stackTrace={longPath} />);
      const scroller = traceScroller(container);

      // The highlighter's own <pre>/<code> carry inline theme styles that set no overflow-wrap, and
      // its `wrapLongLines` only sets `pre-wrap` - which breaks at spaces a long path does not have.
      expect(scroller.className).toContain("[&_pre]:break-words");
      expect(scroller.className).toContain("[&_code]:break-words");
      expect(container.textContent).toContain("File.cs:line 9");
    });

    it("wraps the Suspense fallback trace too, before the highlighter resolves", () => {
      const noNewlines = "B".repeat(400);
      const { container } = render(<ErrorDisplay message="M" stackTrace={noNewlines} />);
      const pre = container.querySelector("pre");

      // The fallback renders synchronously on first paint, so it needs its own wrapping rules.
      if (pre) {
        expect(pre.className).toContain("whitespace-pre-wrap");
        expect(pre.className).toContain("break-words");
      }
      expect(container.textContent).toContain(noNewlines);
    });
  });
});
