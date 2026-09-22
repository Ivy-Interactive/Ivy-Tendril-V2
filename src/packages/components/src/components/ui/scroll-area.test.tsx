import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import "@testing-library/jest-dom";

import { ScrollArea } from "./scroll-area";

const viewportOf = (container: HTMLElement): HTMLElement => {
  const viewport = container.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
  if (!viewport) throw new Error("scroll area viewport not found");
  return viewport;
};

/**
 * `fitWidth` overrides the `display: table` wrapper Radix puts around a scroll area's content, which is
 * shrink-to-fit and so grows to its content's min-content width. The override is a class on the
 * viewport rather than a style on the wrapper, because Radix owns the wrapper and writes its `display`
 * inline on every render — so the class, which carries `!important`, is what is asserted. jsdom does
 * no layout, so whether the content then fits is checked in the blades and KPI sheet stories.
 */
describe("ScrollArea fitWidth", () => {
  it("lays the content wrapper out as a block when asked", () => {
    const { container } = render(
      <ScrollArea fitWidth>
        <p>Content</p>
      </ScrollArea>,
    );

    expect(viewportOf(container)).toHaveClass("[&>div]:!block");
  });

  /**
   * Opt-in, because a caller that scrolls sideways can depend on the wrapper growing with its content:
   * `MarkdownCodeBlock`'s padding only reaches past its longest line because the table it sits in does.
   */
  it("leaves Radix's shrink-to-fit wrapper alone by default", () => {
    const { container } = render(
      <ScrollArea>
        <p>Content</p>
      </ScrollArea>,
    );

    expect(viewportOf(container)).not.toHaveClass("[&>div]:!block");
  });

  it("keeps a caller's own viewport classes alongside it", () => {
    const { container } = render(
      <ScrollArea fitWidth viewportClassName="[&>div]:!h-full">
        <p>Content</p>
      </ScrollArea>,
    );

    expect(viewportOf(container)).toHaveClass("[&>div]:!block", "[&>div]:!h-full");
  });
});
