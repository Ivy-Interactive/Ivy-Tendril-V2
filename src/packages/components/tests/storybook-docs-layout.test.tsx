import { describe, expect, it } from "vite-plus/test";
import previewConfig from "../.storybook/preview";
import { CatchingError } from "../src/stories/ErrorBoundary.stories";

/**
 * The Diagnostics/ErrorBoundary docs page did not fit, for two independent reasons. jsdom applies no
 * CSS, so these assert the class contract the fix rests on rather than measured pixels; the measured
 * geometry behind each number was taken in Chromium at 1280x900 against the static build.
 */

interface DecoratedElement {
  props: { className: string };
}

type PreviewDecorator = (
  Story: React.ComponentType,
  context: { globals?: { theme?: string }; viewMode?: string },
) => DecoratedElement;

const decorator = (previewConfig.decorators as unknown as PreviewDecorator[])[0]!;
const NullStory = () => null;

const decorate = (context: Parameters<PreviewDecorator>[1]) =>
  decorator(NullStory, context).props.className;

describe("preview decorator canvas height", () => {
  /*
   * A docs page inlines every story of a file into one scrolling column. `min-h-screen` floors each
   * of those previews at a full viewport height whatever it renders, so the reader scrolls past a
   * screen of blank background between sections. Measured on the ErrorBoundary docs page: a 372px
   * card inside a 900px preview block, 529px of it empty, and the same on every docs page in the
   * build (ui-spinner--docs rendered 44px of content per 900px preview).
   */
  it("does not floor a docs preview at a full viewport height", () => {
    expect(decorate({ viewMode: "docs" })).not.toContain("min-h-screen");
    expect(decorate({ viewMode: "docs", globals: { theme: "dark" } })).not.toContain(
      "min-h-screen",
    );
  });

  // Story view is the case `min-h-screen` was for: there the iframe is the viewport, and a story
  // that lays out against the full height needs it. Only the docs path changes.
  it("keeps the full-height canvas in story view", () => {
    expect(decorate({ viewMode: "story" })).toContain("min-h-screen");
  });

  // `viewMode` is absent when the decorator runs outside a rendered story (the unit tests in
  // storybook-globals.test.ts call it with a bare context). Story view is the safe default.
  it("keeps the full-height canvas when viewMode is absent", () => {
    expect(decorate({})).toContain("min-h-screen");
  });

  it("still applies the theme and the padding in both view modes", () => {
    for (const viewMode of ["docs", "story"]) {
      expect(decorate({ viewMode })).toContain("bg-background");
      expect(decorate({ viewMode })).toContain("text-foreground");
      expect(decorate({ viewMode })).toContain("p-6");
      expect(decorate({ viewMode, globals: { theme: "dark" } })).toContain("dark");
    }
  });
});

describe("Diagnostics/ErrorBoundary CatchingError host box", () => {
  const hostClassName = (CatchingError.render as unknown as () => DecoratedElement)().props
    .className;

  /*
   * `ErrorDisplay` is a `h-full` flex column whose stack-trace scroller is bounded by
   * `flex-1 min-h-0`, so the host has to have a height of its own or the scroller never resolves.
   * That is why this box is sized at all.
   */
  it("gives the fallback a bounded height to resolve flex-1 against", () => {
    expect(hostClassName).toMatch(/\bh-\[\d+rem\]|\bh-\d+\b/);
  });

  /*
   * The height then has to clear the fallback. At `h-80` the box measured 346px once its own padding
   * and border were counted, which left the scroller 117px against a 406px trace: 71% of the stack
   * trace this story exists to demonstrate was hidden, cut off mid-line at the bottom edge. At
   * `max-w-2xl` + `h-[32rem]` the trace wraps to 283px and fits whole, with the scroller still there
   * for anything longer. `h-80` specifically must not come back.
   */
  it("is tall enough to show the whole caught stack trace", () => {
    expect(hostClassName).not.toContain("h-80");
    const rem = /h-\[(\d+)rem\]/.exec(hostClassName);
    expect(rem, `expected a rem height, got: ${hostClassName}`).not.toBeNull();
    expect(Number(rem![1])).toBeGreaterThanOrEqual(32);
  });

  /*
   * And wide enough that the trace's frame URLs wrap into fewer lines. At `max-w-xl` (576px) the same
   * 32rem box still hid 123px of the trace; `max-w-2xl` (672px) brought it to zero.
   */
  it("is wide enough that the trace wraps into the available height", () => {
    expect(hostClassName).not.toContain("max-w-xl");
    expect(hostClassName).toContain("max-w-2xl");
  });
});
