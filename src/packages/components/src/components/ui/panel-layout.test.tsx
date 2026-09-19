import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { FooterLayout, HeaderLayout } from "./panel-layout";

/**
 * The two panel layouts, against `Ivy-Framework/src/frontend/src/widgets/layouts/HeaderLayoutWidget.tsx`
 * and `FooterLayoutWidget.tsx`.
 *
 * Two things are worth a test here and they are the two that are easy to get wrong:
 *
 * 1. **`min-h-0` on the scrolling child.** Without it a flex item will not shrink below its content, so
 *    the panel grows past its parent and the "fixed" chrome scrolls away with the page. It is invisible in
 *    jsdom — no layout — so it is asserted as a class rather than as a measurement.
 * 2. **The scroll shadow.** The header takes one once the body is scrolled; the footer takes one *while*
 *    there is more below. A footer with no shadow over a scrollable body reads as the end of the content.
 */

/** The Radix viewport the hooks observe. */
function viewport(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
  if (!element) throw new Error("No ScrollArea viewport rendered");
  return element;
}

/** jsdom reports every dimension as 0, so an overflowing viewport has to be described. */
function describeScroll(element: HTMLElement, scrollTop: number, content: number, visible: number) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: content });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: visible });
  element.scrollTop = scrollTop;
}

describe("HeaderLayout", () => {
  it("pins the header over a scrolling body, with the framework's own structure", () => {
    const { container } = render(
      <HeaderLayout header={<h2>Job Output</h2>}>
        <p>body</p>
      </HeaderLayout>,
    );

    const root = container.querySelector('[data-slot="header-layout"]');
    expect(root).toHaveClass("flex", "h-full", "w-full", "flex-col");

    const header = container.querySelector('[data-slot="header-layout-header"]');
    expect(header).toHaveClass("flex-none", "p-2", "w-full");
    // `showHeaderDivider` defaults to true.
    expect(header).toHaveClass("border-b");

    // The scroller: `flex-1 min-h-0 overflow-hidden`. `min-h-0` is the load-bearing one.
    const scroller = header?.nextElementSibling;
    expect(scroller).toHaveClass("flex-1", "min-h-0", "overflow-hidden");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("drops the divider when asked", () => {
    const { container } = render(
      <HeaderLayout header={<span>h</span>} showDivider={false}>
        <p>body</p>
      </HeaderLayout>,
    );
    expect(container.querySelector('[data-slot="header-layout-header"]')).not.toHaveClass(
      "border-b",
    );
  });

  it("shadows the header once the body has been scrolled, and not before", () => {
    const { container } = render(
      <HeaderLayout header={<span>h</span>}>
        <p>body</p>
      </HeaderLayout>,
    );
    const header = container.querySelector('[data-slot="header-layout-header"]');
    expect(header).not.toHaveClass("shadow-sm");

    const scroll = viewport(container);
    describeScroll(scroll, 120, 1000, 300);
    act(() => {
      fireEvent.scroll(scroll);
    });
    expect(header).toHaveClass("shadow-sm");

    describeScroll(scroll, 0, 1000, 300);
    act(() => {
      fireEvent.scroll(scroll);
    });
    expect(header).not.toHaveClass("shadow-sm");
  });

  it("hands scrolling to the content when the content windows its own rows", () => {
    // A body that virtualises would otherwise fight an outer scroll container for the scroll position.
    const { container } = render(
      <HeaderLayout header={<span>h</span>} scrollContent={false}>
        <p>body</p>
      </HeaderLayout>,
    );
    expect(container.querySelector("[data-radix-scroll-area-viewport]")).not.toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});

describe("FooterLayout", () => {
  it("pins the footer under a scrolling body, with a divider above it", () => {
    const { container } = render(
      <FooterLayout footer={<button type="button">Save</button>}>
        <p>body</p>
      </FooterLayout>,
    );

    const scroller = container.querySelector('[data-slot="footer-layout"]')?.firstElementChild;
    expect(scroller).toHaveClass("flex-1", "min-h-0", "overflow-hidden");

    const footer = container.querySelector('[data-slot="footer-layout-footer"]');
    expect(footer).toHaveClass("flex-none", "w-full", "bg-background");
    expect(footer?.firstElementChild).toHaveClass("border-t");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("shadows the footer while content remains below, and clears it at the end", () => {
    const { container } = render(
      <FooterLayout footer={<span>f</span>}>
        <p>body</p>
      </FooterLayout>,
    );
    const footer = container.querySelector('[data-slot="footer-layout-footer"]');
    const scroll = viewport(container);

    // 1000px of content in a 300px viewport, at the top: 700px still below.
    describeScroll(scroll, 0, 1000, 300);
    act(() => {
      fireEvent.scroll(scroll);
    });
    expect(footer?.className).toContain("shadow-[0_-2px_4px_rgba(0,0,0,0.1)]");

    // Scrolled to the end: nothing below, so no shadow. This is the half that says "you have read it all".
    describeScroll(scroll, 700, 1000, 300);
    act(() => {
      fireEvent.scroll(scroll);
    });
    expect(footer?.className).not.toContain("shadow-[0_-2px_4px");
  });

  it("never shadows a body that fits", () => {
    const { container } = render(
      <FooterLayout footer={<span>f</span>}>
        <p>body</p>
      </FooterLayout>,
    );
    const scroll = viewport(container);
    describeScroll(scroll, 0, 300, 300);
    act(() => {
      fireEvent.scroll(scroll);
    });
    expect(container.querySelector('[data-slot="footer-layout-footer"]')?.className).not.toContain(
      "shadow-[0_-2px_4px",
    );
  });
});
