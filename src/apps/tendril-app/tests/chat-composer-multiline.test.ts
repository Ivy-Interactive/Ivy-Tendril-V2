import { describe, it, expect, afterEach } from "vitest";
import { needsMultipleLines } from "../src/views/ChatView";

/**
 * The composer's layout decision — V1's `needsMultipleLines` in
 * `Ivy.Tendril.Widgets/frontend/src/ChatWidget/ChatWidget.tsx`.
 *
 * The prompt shares the row with the buttons until it stops fitting, and only then does the toolbar
 * move above it. jsdom performs no layout, so the two things a real browser would supply —
 * `scrollHeight` and `clientWidth`/`offsetWidth` — are stubbed here; everything else is the real
 * function, including the temporary style swap that gives it its hysteresis.
 */
describe("composer single-line vs multiline", () => {
  const PADDING = 6;
  const LINE_HEIGHT = 20;

  /** Characters that fit on one line at the width the textarea is being measured at. */
  let charsPerLine = 40;
  const created: HTMLElement[] = [];

  afterEach(() => {
    for (const el of created) el.remove();
    created.length = 0;
    charsPerLine = 40;
  });

  /**
   * A composer row: the attach button, the textarea, the tools cluster. `scrollHeight` is derived
   * from the width the function has just set on the textarea, which is what makes the hysteresis
   * observable — a wider measurement fits more characters per line.
   */
  const buildRow = (value: string, rowWidth = 700) => {
    const row = document.createElement("div");
    row.style.columnGap = "12px";
    Object.defineProperty(row, "clientWidth", { value: rowWidth, configurable: true });

    const sibling = (width: number) => {
      const el = document.createElement("div");
      Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
      return el;
    };

    const attach = sibling(32);
    const tools = sibling(300);
    const textarea = document.createElement("textarea");
    textarea.value = value;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get() {
        // The width the function set for the measurement, or the inline width when it has not.
        const width = Number.parseFloat(textarea.style.width) || rowWidth;
        const perLine = Math.max(1, Math.floor((width / 400) * charsPerLine));
        const lines = Math.max(1, Math.ceil(textarea.value.length / perLine));
        return lines * LINE_HEIGHT + PADDING * 2;
      },
    });
    textarea.style.paddingTop = `${PADDING}px`;
    textarea.style.paddingBottom = `${PADDING}px`;
    textarea.style.lineHeight = `${LINE_HEIGHT}px`;

    row.append(attach, textarea, tools);
    document.body.append(row);
    created.push(row);
    return { row, textarea };
  };

  it("keeps an empty composer on one line", () => {
    const { row, textarea } = buildRow("");
    expect(needsMultipleLines(textarea, row)).toBe(false);
  });

  it("keeps a short prompt beside the buttons", () => {
    const { row, textarea } = buildRow("hello");
    expect(needsMultipleLines(textarea, row)).toBe(false);
  });

  it("moves the toolbar once the prompt no longer fits inline", () => {
    // The inline width is 700 - 32 - 300 - (12 * 2) = 344px, so ~34 characters fit.
    const { row, textarea } = buildRow("x".repeat(200));
    expect(needsMultipleLines(textarea, row)).toBe(true);
  });

  it("goes multiline immediately on an explicit newline, however short", () => {
    const { row, textarea } = buildRow("a\nb");
    expect(needsMultipleLines(textarea, row)).toBe(true);
  });

  it("stays on one line before the composer has been laid out", () => {
    // V1's guard: with no width to measure at, the placeholder itself would look like it wraps, and
    // the composer would start in the multiline layout on first paint.
    const { textarea } = buildRow("x".repeat(200), 0);
    const zeroWidthRow = document.createElement("div");
    Object.defineProperty(zeroWidthRow, "clientWidth", { value: 0, configurable: true });
    expect(needsMultipleLines(textarea, zeroWidthRow)).toBe(false);
    expect(needsMultipleLines(textarea, null)).toBe(false);
  });

  it("does not flip back once the toolbar has moved above and widened the text", () => {
    // The hysteresis case, and the one a port loses. The prompt is long enough to wrap at the inline
    // width but not at the full width, so measuring the *live* element in the multiline layout would
    // say one line is enough — and the composer would oscillate every time it was measured.
    const value = "x".repeat(60);
    const { row, textarea } = buildRow(value);
    expect(needsMultipleLines(textarea, row)).toBe(true);

    // Now the multiline layout is showing: the textarea spans the row.
    textarea.style.flex = "0 0 auto";
    textarea.style.width = "700px";
    expect(textarea.scrollHeight).toBe(LINE_HEIGHT + PADDING * 2); // one line, at full width
    // Measured again, it still reports multiline, because the question is asked at the inline width.
    expect(needsMultipleLines(textarea, row)).toBe(true);
  });

  it("restores the styles it borrowed for the measurement", () => {
    const { row, textarea } = buildRow("x".repeat(200));
    textarea.style.flex = "1";
    textarea.style.width = "";
    textarea.style.height = "48px";
    // Whatever the engine normalised these to is what has to come back: the function saves and
    // restores the reported values, not the ones the caller wrote.
    const before = {
      flex: textarea.style.flex,
      width: textarea.style.width,
      height: textarea.style.height,
    };
    needsMultipleLines(textarea, row);
    expect(textarea.style.flex).toBe(before.flex);
    expect(textarea.style.width).toBe(before.width);
    expect(textarea.style.height).toBe(before.height);
  });

  it("counts lines rather than comparing a total, so one line is never on the boundary", () => {
    // A single line of 14px text with `leading-5` and `py-1.5` is exactly 32px, so `scrollHeight > 32`
    // sat on the boundary and any half-pixel tipped a one-character prompt into the multiline layout.
    const { row, textarea } = buildRow("h");
    Object.defineProperty(textarea, "scrollHeight", { value: 32.5, configurable: true });
    expect(needsMultipleLines(textarea, row)).toBe(false);

    // Two lines still read as two, fractional or not.
    Object.defineProperty(textarea, "scrollHeight", { value: 52.4, configurable: true });
    expect(needsMultipleLines(textarea, row)).toBe(true);
  });
});
