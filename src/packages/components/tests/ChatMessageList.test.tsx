import { createRef } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessageList } from "../src/components/ChatMessageList";

function forceNotAtBottom(el: HTMLElement) {
  Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 200, configurable: true });
  el.scrollTop = 0;
  fireEvent.scroll(el);
}

async function flushRaf() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("ChatMessageList", () => {
  it("renders message children inside scroll container", () => {
    const { container } = render(
      <ChatMessageList>
        <div>Message 1</div>
        <div>Message 2</div>
      </ChatMessageList>,
    );
    expect(container.textContent).toContain("Message 1");
    expect(container.textContent).toContain("Message 2");
    expect(container.querySelector(".overflow-y-auto")).not.toBeNull();
  });

  it("shows the scroll button by default once scrolled away from the bottom", () => {
    const { container, getByLabelText } = render(
      <ChatMessageList>
        <div>Message 1</div>
      </ChatMessageList>,
    );
    const el = container.querySelector(".overflow-y-auto") as HTMLElement;
    forceNotAtBottom(el);
    expect(getByLabelText("Scroll to bottom")).not.toBeNull();
  });

  it("never renders the scroll button when showScrollButton is false", () => {
    const { container, queryByLabelText } = render(
      <ChatMessageList showScrollButton={false}>
        <div>Message 1</div>
      </ChatMessageList>,
    );
    const el = container.querySelector(".overflow-y-auto") as HTMLElement;
    forceNotAtBottom(el);
    expect(queryByLabelText("Scroll to bottom")).toBeNull();
  });

  it("leaves the scroll position alone when enableAutoScroll is false", async () => {
    const { container, rerender } = render(
      <ChatMessageList enableAutoScroll={false}>
        <div>Message 1</div>
      </ChatMessageList>,
    );
    const el = container.querySelector(".overflow-y-auto") as HTMLElement;
    const scrollTo = vi.fn();
    Object.defineProperty(el, "scrollTo", { value: scrollTo, configurable: true });
    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });

    rerender(
      <ChatMessageList enableAutoScroll={false}>
        <div>Message 1</div>
        <div>Message 2</div>
      </ChatMessageList>,
    );
    await flushRaf();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(el.scrollTop).toBe(0);
  });

  it("scrolls to bottom by default when enableAutoScroll is omitted", async () => {
    const { container, rerender } = render(
      <ChatMessageList>
        <div>Message 1</div>
      </ChatMessageList>,
    );
    const el = container.querySelector(".overflow-y-auto") as HTMLElement;
    const scrollTo = vi.fn();
    Object.defineProperty(el, "scrollTo", { value: scrollTo, configurable: true });
    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });

    rerender(
      <ChatMessageList>
        <div>Message 1</div>
        <div>Message 2</div>
      </ChatMessageList>,
    );
    await flushRaf();

    expect(scrollTo).toHaveBeenCalled();
  });

  it("still forwards the ref to the scroll container with both new props disabled", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ChatMessageList enableAutoScroll={false} showScrollButton={false} ref={ref}>
        <div>Message 1</div>
      </ChatMessageList>,
    );
    expect(ref.current?.classList.contains("overflow-y-auto")).toBe(true);
  });
});
