import * as React from "react";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import "@testing-library/jest-dom";

import { BladeContainer, type BladeContainerProps } from "./BladeContainer";
import { useBlades } from "./context";
import type { BladeContainerHandle, BladeDescriptor } from "./types";

const WIDE = 1280;
const NARROW = 400;

const mediaListeners = new Set<() => void>();

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
}

function resizeViewport(width: number) {
  setViewportWidth(width);
  act(() => {
    for (const listener of mediaListeners) listener();
  });
}

beforeEach(() => {
  mediaListeners.clear();
  setViewportWidth(WIDE);

  // jsdom implements neither matchMedia (which useIsMobile subscribes to) nor Element.scrollTo
  // (which the auto-scroll effect calls).
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? "0");
    return {
      matches: window.innerWidth <= max,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_type: string, listener: () => void) => {
        mediaListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        mediaListeners.delete(listener);
      },
      dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;

  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = vi.fn();
  }
});

function handleOf(ref: React.RefObject<BladeContainerHandle | null>): BladeContainerHandle {
  const handle = ref.current;
  if (!handle) throw new Error("BladeContainer handle is not attached");
  return handle;
}

function bladeSections(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-blade-index]:not([data-blade-exiting])"),
  );
}

function sectionAt(index: number): HTMLElement {
  const section = document.querySelector<HTMLElement>(`[data-blade-index="${index}"]`);
  if (!section) throw new Error(`No blade at index ${index}`);
  return section;
}

function titleOf(section: HTMLElement): string {
  return section.querySelector("h2")?.textContent ?? "";
}

const root: BladeDescriptor = { title: "Projects", content: <p>Project list</p> };

function blade(title: string, extra?: Partial<BladeDescriptor>): BladeDescriptor {
  return { title, content: <p>{title} body</p>, ...extra };
}

/** Pushes from inside a blade body, so the pushing control is a real focus invoker. */
function PushButton({ label, next }: { label: string; next: BladeDescriptor }) {
  const { push } = useBlades();
  return (
    <button type="button" onClick={() => push(next)}>
      {label}
    </button>
  );
}

/** Unmounts itself as soon as the stack grows, to exercise the lost-invoker fallback. */
function DisappearingPushButton({ label, next }: { label: string; next: BladeDescriptor }) {
  const { push, depth } = useBlades();
  if (depth > 1) return <p>invoker gone</p>;
  return (
    <button type="button" onClick={() => push(next)}>
      {label}
    </button>
  );
}

function renderStack(props: Partial<BladeContainerProps> = {}) {
  const ref = React.createRef<BladeContainerHandle>();
  const utils = render(<BladeContainer ref={ref} root={root} transitionDuration={0} {...props} />);
  return { ...utils, ref };
}

/** Pushes blades through the imperative handle and returns their resolved ids. */
function pushAll(
  ref: React.RefObject<BladeContainerHandle | null>,
  ...blades: BladeDescriptor[]
): string[] {
  const ids: string[] = [];
  for (const descriptor of blades) {
    act(() => {
      ids.push(handleOf(ref).push(descriptor));
    });
  }
  return ids;
}

describe("BladeContainer", () => {
  it("renders the root blade as a named landmark with no close affordance", () => {
    renderStack();

    const region = screen.getByRole("region", { name: "Projects" });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("data-blade-index", "0");
    expect(within(region).queryByRole("button", { name: /^Close/ })).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /^Back/ })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Blades" })).toBeInTheDocument();
  });

  it("push appends a blade, raises the depth and reports it", () => {
    const onDepthChange = vi.fn();
    const { ref } = renderStack({ onDepthChange });

    pushAll(ref, blade("Detail"));

    const sections = bladeSections();
    expect(sections).toHaveLength(2);
    expect(titleOf(sections[1])).toBe("Detail");
    expect(sections[1].parentElement?.lastElementChild).toBe(sections[1]);
    expect(onDepthChange).toHaveBeenCalledWith(2);
  });

  it("pop removes only the deepest blade, and pop(count) unwinds several at once", () => {
    const { ref } = renderStack();
    pushAll(ref, blade("Detail"), blade("Edit"), blade("Advanced"));
    expect(bladeSections()).toHaveLength(4);

    act(() => handleOf(ref).pop());
    expect(bladeSections().map(titleOf)).toEqual(["Projects", "Detail", "Edit"]);

    act(() => handleOf(ref).pop(2));
    expect(bladeSections().map(titleOf)).toEqual(["Projects"]);
  });

  it("replace swaps the deepest blade without changing the depth", () => {
    const { ref } = renderStack();
    pushAll(ref, blade("Detail"));

    act(() => handleOf(ref).replace({ title: "Renamed", content: <p>Renamed body</p> }));

    expect(bladeSections().map(titleOf)).toEqual(["Projects", "Renamed"]);
    expect(screen.getByText("Renamed body")).toBeInTheDocument();
    expect(screen.queryByText("Detail body")).not.toBeInTheDocument();
  });

  it("popTo unwinds to a depth in one call and clamps at the root", () => {
    const { ref } = renderStack();
    pushAll(ref, blade("Detail"), blade("Edit"), blade("Advanced"));

    act(() => handleOf(ref).popTo(1));
    expect(bladeSections().map(titleOf)).toEqual(["Projects"]);

    act(() => handleOf(ref).popTo(0));
    expect(bladeSections().map(titleOf)).toEqual(["Projects"]);
  });

  it("popToId makes the named blade the deepest one", () => {
    const { ref } = renderStack();
    const [detailId] = pushAll(ref, blade("Detail"), blade("Edit"), blade("Advanced"));

    act(() => handleOf(ref).popToId(detailId));

    expect(bladeSections().map(titleOf)).toEqual(["Projects", "Detail"]);
  });

  it("Escape pops the deepest blade and is left alone at the root", async () => {
    const user = userEvent.setup();
    const outerListener = vi.fn();
    document.addEventListener("keydown", outerListener);

    try {
      const { ref } = renderStack();
      pushAll(ref, blade("Detail"), blade("Edit"));
      expect(bladeSections()).toHaveLength(3);

      await user.keyboard("{Escape}");
      expect(bladeSections().map(titleOf)).toEqual(["Projects", "Detail"]);

      await user.keyboard("{Escape}");
      expect(bladeSections().map(titleOf)).toEqual(["Projects"]);

      outerListener.mockClear();
      await user.keyboard("{Escape}");
      expect(bladeSections().map(titleOf)).toEqual(["Projects"]);
      expect(outerListener).toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", outerListener);
    }
  });

  it("moves focus into a pushed blade", async () => {
    const user = userEvent.setup();
    render(
      <BladeContainer
        transitionDuration={0}
        root={{
          title: "Projects",
          content: <PushButton label="Open detail" next={blade("Detail")} />,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open detail" }));

    expect(sectionAt(1)).toHaveFocus();
  });

  it("returns focus to the invoking control on close, Escape and a programmatic pop", async () => {
    const user = userEvent.setup();
    const ref = React.createRef<BladeContainerHandle>();
    render(
      <BladeContainer
        ref={ref}
        transitionDuration={0}
        root={{
          title: "Projects",
          content: <PushButton label="Open detail" next={blade("Detail")} />,
        }}
      />,
    );
    const invoker = screen.getByRole("button", { name: "Open detail" });

    await user.click(invoker);
    await user.click(screen.getByRole("button", { name: "Close Detail" }));
    expect(invoker).toHaveFocus();

    await user.click(invoker);
    await user.keyboard("{Escape}");
    expect(invoker).toHaveFocus();

    await user.click(invoker);
    act(() => handleOf(ref).pop());
    expect(invoker).toHaveFocus();
  });

  it("falls back to the deepest blade when the invoking control is gone", async () => {
    const user = userEvent.setup();
    const ref = React.createRef<BladeContainerHandle>();
    render(
      <BladeContainer
        ref={ref}
        transitionDuration={0}
        root={{
          title: "Projects",
          content: <DisappearingPushButton label="Open detail" next={blade("Detail")} />,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open detail" }));
    expect(screen.getByText("invoker gone")).toBeInTheDocument();

    act(() => handleOf(ref).pop());

    expect(sectionAt(0)).toHaveFocus();
  });

  it("closing a blade mid-stack pops everything deeper and fires each onClose", async () => {
    const user = userEvent.setup();
    const onCloseDetail = vi.fn();
    const onCloseEdit = vi.fn();
    const { ref } = renderStack();
    pushAll(
      ref,
      blade("Detail", { onClose: onCloseDetail }),
      blade("Edit", { onClose: onCloseEdit }),
    );

    await user.click(screen.getByRole("button", { name: "Close Detail" }));

    expect(bladeSections().map(titleOf)).toEqual(["Projects"]);
    expect(onCloseDetail).toHaveBeenCalledTimes(1);
    expect(onCloseEdit).toHaveBeenCalledTimes(1);
  });

  it("applies width hints as classes and any other length inline", () => {
    const { ref } = renderStack();
    pushAll(
      ref,
      blade("Large", { width: "lg" }),
      blade("Flexible", { width: "flex" }),
      blade("Custom", { width: "30rem" }),
      blade("Default"),
    );

    const large = sectionAt(1);
    expect(large.className).toContain("w-136");
    expect(large.style.width).toBe("");

    expect(sectionAt(2).className).toContain("flex-1");
    expect(sectionAt(2).className).toContain("contain-inline-size");

    const custom = sectionAt(3);
    expect(custom.style.width).toBe("30rem");
    expect(custom.style.maxWidth).toBe("30rem");
    expect(custom.className).toContain("shrink-0");

    expect(sectionAt(4).className).toContain("w-104");
    expect(sectionAt(0).className).toContain("w-104");
  });

  it("collapses to the deepest blade on a narrow viewport and retains the stack", async () => {
    const user = userEvent.setup();
    setViewportWidth(NARROW);
    const { ref } = renderStack({ collapseBreakpoint: 480 });
    pushAll(ref, blade("Detail"), blade("Edit"));

    let sections = bladeSections();
    expect(sections).toHaveLength(1);
    expect(titleOf(sections[0])).toBe("Edit");
    expect(sections[0].className).toContain("w-full");
    expect(sections[0].className).not.toContain("w-104");
    expect(screen.queryByRole("button", { name: "Close Edit" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to Detail" }));
    sections = bladeSections();
    expect(sections).toHaveLength(1);
    expect(titleOf(sections[0])).toBe("Detail");

    resizeViewport(WIDE);
    expect(bladeSections().map(titleOf)).toEqual(["Projects", "Detail"]);
  });

  it("drives the stack from outside the provider through the imperative handle", () => {
    const { ref } = renderStack();

    pushAll(ref, blade("Detail"), blade("Edit"));
    expect(bladeSections()).toHaveLength(3);

    act(() => handleOf(ref).pop());
    expect(bladeSections()).toHaveLength(2);

    pushAll(ref, blade("Other"));
    act(() => handleOf(ref).popTo(2));
    expect(bladeSections()).toHaveLength(2);

    act(() => handleOf(ref).reset());
    expect(bladeSections().map(titleOf)).toEqual(["Projects"]);
  });

  it("renders the refresh affordance only when onRefresh is supplied", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const { ref } = renderStack();

    expect(screen.queryByRole("button", { name: /^Refresh/ })).not.toBeInTheDocument();

    pushAll(ref, blade("Detail", { onRefresh }));

    await user.click(screen.getByRole("button", { name: "Refresh Detail" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("moves focus between blades with arrow keys, but not from inside blade content", async () => {
    const user = userEvent.setup();
    const { ref } = renderStack();
    pushAll(ref, blade("Detail", { content: <input aria-label="Project name" /> }));

    act(() => sectionAt(1).focus());
    await user.keyboard("{ArrowLeft}");
    expect(sectionAt(0)).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(sectionAt(1)).toHaveFocus();

    const input = screen.getByLabelText("Project name");
    await user.click(input);
    await user.keyboard("{ArrowLeft}");
    expect(input).toHaveFocus();
  });

  /**
   * How the row is sized, which is what decides whether a `width: "flex"` blade matches its pane.
   *
   * `w-max` alone made the row's main size intrinsic, and a `flex-1 min-w-0` item inside a max-content
   * flex container is sized by its own max-content contribution (CSS Flexbox §9.9.1) — `min-w-0` removes
   * the automatic *minimum* and does nothing about that. So the root blade came out as wide as its
   * content wanted rather than as wide as the pane: Tendril's project settings screen laid ~1200px of
   * content inside a ~950px window, and the "Add …" buttons on its right edge went off-screen.
   *
   * `min-w-full` is the floor that makes the row match the pane, while leaving `w-max` free to exceed it
   * when a stack of fixed-width blades genuinely needs more room. It is only a floor: the Dashboard's KPI
   * sheet, a lone flex blade whose callout is one long sentence, still made a 1211px row in a 768px
   * sheet, and the scroll-into-view then parked the start of every line off the left edge. The other
   * half is on the blade — see the flex cases below.
   */
  describe("the blade row's width", () => {
    const rowOf = (): HTMLElement => {
      const row = sectionAt(0).parentElement;
      if (!row) throw new Error("blade row not found");
      return row;
    };

    it("fills the container at least", () => {
      renderStack();

      const row = rowOf();
      expect(row).toHaveClass("w-max");
      expect(row).toHaveClass("min-w-full");
    });

    /**
     * The half of "a flex blade is not sized by its content" that the row cannot do. A max-content row
     * asks each blade how wide it would like to be, and inline-size containment is what makes a flex
     * blade answer as if it were empty: the row is then sized by the pane and the fixed blades, and
     * `flex-1` hands the flex blade what is left over.
     *
     * `min-w-80` is asserted with it because containment alone answers *zero*. Beside a stack wider
     * than the pane that would leave the flex blade a hairline; `sm`'s width is the floor, and the row
     * scrolls instead.
     */
    it("keeps a flex blade's content out of the row's width, down to a floor", () => {
      const { ref } = renderStack({ root: { ...root, width: "flex" } });
      pushAll(ref, blade("Detail", { width: "lg" }));

      expect(sectionAt(0)).toHaveClass("flex-1", "contain-inline-size", "min-w-80");
      // A fixed hint already answers with its own width, so it is left exactly as it was.
      expect(sectionAt(1)).toHaveClass("w-136", "shrink-0");
      expect(sectionAt(1)).not.toHaveClass("contain-inline-size");
    });

    it("drops the flex sizing when collapsed, where the one visible blade is the full row", () => {
      renderStack({ root: { ...root, width: "flex" } });
      resizeViewport(NARROW);

      const only = sectionAt(0);
      expect(only).toHaveClass("w-full", "min-w-0");
      expect(only).not.toHaveClass("contain-inline-size");
      expect(only).not.toHaveClass("min-w-80");
    });

    /**
     * Inside the blade, the same question one level down. Radix wraps a scroll area's content in a
     * `display: table` div, which is never narrower than its content's min-content width — so one table
     * with a path in a `nowrap` column made the whole body wider than the blade, clipped on the right
     * because the body only scrolls downwards. `fitWidth` makes that wrapper a block at the viewport's
     * width: prose wraps to the blade, and the table scrolls inside its own frame.
     *
     * The class is what is asserted because the wrapper's `display` is an inline style Radix writes and
     * the override is `!important`; jsdom resolves neither against the other, and does no layout.
     */
    it("lays each blade's body out at the blade's width, not its widest child's", () => {
      const { ref } = renderStack();
      pushAll(ref, blade("Detail"));

      for (const index of [0, 1]) {
        const viewport = sectionAt(index).querySelector("[data-radix-scroll-area-viewport]");
        expect(viewport).not.toBeNull();
        expect(viewport).toHaveClass("[&>div]:!block");
      }
    });

    it("is a plain full-width row when collapsed, where there is only one blade", () => {
      renderStack();
      resizeViewport(NARROW);

      const row = rowOf();
      expect(row).toHaveClass("w-full");
      // `w-max` would let the single visible blade exceed a phone's viewport.
      expect(row).not.toHaveClass("w-max");
    });

    /**
     * Radix leaves a viewport's `overflow-x` at `hidden` until a horizontal scrollbar is *rendered*, so
     * without one a row wider than the pane was clipped: the blades past the right edge could only be
     * reached by the container's own `scrollIntoView`, never by the user.
     *
     * The viewport's style is what is asserted, not a scrollbar element. `type="hover"` defers the
     * thumb's DOM until the pointer is over the area, but `ScrollAreaScrollbar` flips
     * `scrollbarXEnabled` from its mount effect either way — so the style is both the thing that
     * actually fixes the clipping and the thing that is observable without layout.
     */
    it("lets the viewport scroll sideways, since the stack grows that way", () => {
      const { ref } = renderStack();
      pushAll(ref, blade("Detail"), blade("Edit"));

      const viewport = document.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
      expect(viewport).not.toBeNull();
      expect(viewport!.style.overflowX).toBe("scroll");
    });
  });

  it("closes a blade on a middle-click of its header", () => {
    const { ref } = renderStack();
    pushAll(ref, blade("Detail"));

    const header = sectionAt(1).querySelector("[data-blade-header]");
    expect(header).not.toBeNull();
    fireEvent.mouseDown(header as Element, { button: 1 });

    expect(bladeSections().map(titleOf)).toEqual(["Projects"]);

    // The root header ignores middle-clicks.
    fireEvent.mouseDown(sectionAt(0).querySelector("[data-blade-header]") as Element, {
      button: 1,
    });
    expect(bladeSections()).toHaveLength(1);
  });
});
