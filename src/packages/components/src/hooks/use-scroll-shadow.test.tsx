import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { useScrollShadow, type ScrollShadowDirection } from "./use-scroll-shadow";

/** jsdom reports every scroll metric as a non-writable 0, so each one has to be defined outright. */
const setMetrics = (
  el: Element,
  metrics: { scrollTop?: number; scrollHeight?: number; clientHeight?: number },
) => {
  for (const [name, value] of Object.entries(metrics)) {
    Object.defineProperty(el, name, { value, configurable: true });
  }
};

const Probe = ({ direction }: { direction: ScrollShadowDirection }) => {
  const { isScrolled, scrollRef } = useScrollShadow(undefined, direction);
  return (
    <div ref={scrollRef} data-testid="root" data-scrolled={String(isScrolled)}>
      <div data-radix-scroll-area-viewport="" data-testid="viewport" />
    </div>
  );
};

describe("useScrollShadow", () => {
  beforeEach(() => {
    if (!window.MutationObserver) {
      window.MutationObserver = class {
        observe() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as unknown as typeof MutationObserver;
    }
  });

  it('flips on once the viewport is scrolled down for direction "bottom"', () => {
    const { getByTestId } = render(<Probe direction="bottom" />);
    const viewport = getByTestId("viewport");

    expect(getByTestId("root")).toHaveAttribute("data-scrolled", "false");

    setMetrics(viewport, { scrollTop: 40, scrollHeight: 500, clientHeight: 100 });
    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(getByTestId("root")).toHaveAttribute("data-scrolled", "true");
  });

  it('flips off once the viewport reaches the bottom for direction "top"', () => {
    const { getByTestId } = render(<Probe direction="top" />);
    const viewport = getByTestId("viewport");

    // Overflowing and not yet at the bottom: the top shadow is on.
    setMetrics(viewport, { scrollTop: 0, scrollHeight: 500, clientHeight: 100 });
    act(() => {
      fireEvent.scroll(viewport);
    });
    expect(getByTestId("root")).toHaveAttribute("data-scrolled", "true");

    // Scrolled to the very bottom: nothing left below, so the shadow goes away.
    setMetrics(viewport, { scrollTop: 400 });
    act(() => {
      fireEvent.scroll(viewport);
    });
    expect(getByTestId("root")).toHaveAttribute("data-scrolled", "false");
  });

  it('reports no shadow for direction "top" when the content does not overflow', () => {
    const { getByTestId } = render(<Probe direction="top" />);
    const viewport = getByTestId("viewport");

    setMetrics(viewport, { scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(getByTestId("root")).toHaveAttribute("data-scrolled", "false");
  });
});
