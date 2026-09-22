import { useState, useEffect, useLayoutEffect, useRef, useCallback, type RefObject } from "react";

/**
 * Breathing room above a pinned message. The thread supplies the same value as its top padding,
 * so a pinned row lands flush with the top of the viewport.
 */
export const PIN_TOP_PADDING = 10;

/** However unsettled the layout stays, the one-shot scroll gives up chasing it after this long. */
const PIN_SCROLL_MAX_ATTEMPTS = 30;

interface Pin {
  messageId: string;
  /** The one-off scroll that brings the pinned row to the top has already happened. */
  scrolled: boolean;
  /**
   * The `scrollTop` this chase itself last wrote, so the next frame can tell "the browser clamped
   * my write" (chase again) apart from "the reader moved it" (stop touching it) — both look like
   * "`scrollTop` isn't what I asked for" from the outside.
   */
  lastWrittenScrollTop: number | null;
  /** Measurements taken while chasing the scroll, bounding the retry loop. */
  attempts: number;
}

const escapeAttribute = (value: string): string => value.replace(/["\\]/g, "\\$&");

export interface UseChatAutoScrollOptions {
  threshold?: number;
  content?: unknown;
  isGenerating?: boolean;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  anchorRef?: RefObject<HTMLDivElement | null>;
  spacerRef?: RefObject<HTMLDivElement | null>;
}

export interface UseChatAutoScrollReturn {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  anchorRef: RefObject<HTMLDivElement | null>;
  /** Sized by the pin so a just-sent message can sit at the top of the viewport. */
  spacerRef: RefObject<HTMLDivElement | null>;
  isLockedToTail: boolean;
  isAtBottom: boolean;
  scrollToTail: (smooth?: boolean) => void;
  resetToTail: () => void;
  notifyContentUpdate: () => void;
  handleScroll: () => void;
  pinMessage: (messageId: string) => void;
  retargetPin: (fromMessageId: string, toMessageId: string) => void;
  clearPin: () => void;
}

export function useChatAutoScroll(options: UseChatAutoScrollOptions = {}): UseChatAutoScrollReturn {
  const {
    threshold = 32,
    content,
    isGenerating,
    scrollContainerRef: externalContainerRef,
    anchorRef: externalAnchorRef,
    spacerRef: externalSpacerRef,
  } = options;

  const [isLockedToTail, setIsLockedToTail] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const internalAnchorRef = useRef<HTMLDivElement | null>(null);
  const internalSpacerRef = useRef<HTMLDivElement | null>(null);

  const scrollContainerRef = externalContainerRef ?? internalContainerRef;
  const anchorRef = externalAnchorRef ?? internalAnchorRef;
  const spacerRef = externalSpacerRef ?? internalSpacerRef;
  const pinRef = useRef<Pin | null>(null);
  /** The id of the chase's currently queued `requestAnimationFrame`, if any — cancellable. */
  const pendingFrameRef = useRef<number | null>(null);

  const isLockedToTailRef = useRef(isLockedToTail);
  isLockedToTailRef.current = isLockedToTail;

  const checkIsAtBottom = useCallback(
    (element: HTMLElement) => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      const distanceToBottom = scrollHeight - scrollTop - clientHeight;
      return distanceToBottom <= threshold;
    },
    [threshold],
  );

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const atBottom = checkIsAtBottom(container);
    if (atBottom) {
      setIsLockedToTail(true);
      setIsAtBottom(true);
    } else {
      setIsLockedToTail(false);
      setIsAtBottom(false);
    }
  }, [checkIsAtBottom, scrollContainerRef]);

  const handleScrollRef = useRef(handleScroll);
  handleScrollRef.current = handleScroll;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const listener = () => handleScrollRef.current();
    container.addEventListener("scroll", listener, { passive: true });
    return () => {
      container.removeEventListener("scroll", listener);
    };
  });

  const scrollToTail = useCallback(
    (smooth: boolean = false) => {
      setIsLockedToTail(true);
      setIsAtBottom(true);
      if (anchorRef.current) {
        anchorRef.current.scrollIntoView?.({ behavior: smooth ? "smooth" : "auto" });
      } else if (scrollContainerRef.current) {
        if (smooth) {
          scrollContainerRef.current.scrollTo?.({
            top: scrollContainerRef.current.scrollHeight,
            behavior: "smooth",
          });
        } else {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      }
    },
    [anchorRef, scrollContainerRef],
  );

  const resetToTail = useCallback(() => {
    setIsLockedToTail(true);
    setIsAtBottom(true);
    if (anchorRef.current) {
      anchorRef.current.scrollIntoView?.({ behavior: "auto" });
    } else if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [anchorRef, scrollContainerRef]);

  const notifyContentUpdate = useCallback(() => {
    if (isLockedToTailRef.current) {
      if (anchorRef.current) {
        anchorRef.current.scrollIntoView?.({ behavior: "auto" });
      } else if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }
  }, [anchorRef, scrollContainerRef]);

  useEffect(() => {
    notifyContentUpdate();
  }, [content, isGenerating, notifyContentUpdate]);

  /**
   * Pins a message to the top of the viewport. The spacer below the thread is sized so that the
   * bottom of the scroll range *is* the pinned position, which is why following the stream and
   * holding the pin are the same scroll — the spacer shrinks as the reply grows, and once the
   * reply is taller than the viewport the usual follow-the-tail behaviour takes over on its own.
   */
  const pinMessage = useCallback((messageId: string) => {
    pinRef.current = {
      messageId,
      scrolled: false,
      lastWrittenScrollTop: null,
      attempts: 0,
    };
    setIsLockedToTail(true);
    setIsAtBottom(true);
  }, []);

  const cancelPendingMeasurement = useCallback(() => {
    if (pendingFrameRef.current !== null) {
      cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
  }, []);

  /**
   * The pinned message was replaced by its server-side copy; keep the pin on the new row.
   *
   * The chase fields reset along with it: the server copy can land at a different offset (it may
   * carry more or less content than the optimistic row did), so a chase that had already latched,
   * or had already spent part of its attempt budget, has to start fresh against the new element
   * rather than inherit progress measured against a row that no longer exists.
   */
  const retargetPin = useCallback(
    (fromMessageId: string, toMessageId: string) => {
      const pin = pinRef.current;
      if (pin && pin.messageId === fromMessageId) {
        cancelPendingMeasurement();
        pinRef.current = {
          messageId: toMessageId,
          scrolled: false,
          lastWrittenScrollTop: null,
          attempts: 0,
        };
      }
    },
    [cancelPendingMeasurement],
  );

  const clearPin = useCallback(() => {
    cancelPendingMeasurement();
    pinRef.current = null;
    const spacer = spacerRef.current;
    if (spacer) spacer.style.height = "0px";
  }, [cancelPendingMeasurement, spacerRef]);

  // A queued chase frame outlives the component if nothing cancels it on unmount: `measurePin`
  // would then run against a detached tree once it fires, reading stale geometry off elements
  // React has already thrown away.
  useEffect(() => cancelPendingMeasurement, [cancelPendingMeasurement]);

  /**
   * Sizes the spacer and, while the one-shot scroll is still chasing the pinned row, scrolls to it.
   *
   * Everything here is geometry, so it is a single function called from three places: React's own
   * render, a ResizeObserver for the growth React never hears about, and — only while the pin
   * hasn't settled yet — a chain of `requestAnimationFrame` calls.
   *
   * The scroll can't just latch after the first write: `sendMessage` sets `isGenerating` in the
   * same notify that appends the optimistic row, so the "Working…" row and the pin spacer both
   * still have to grow into the layout pass that follows. Neither one moves the pinned row itself
   * (both render below it) — what they change is `scrollHeight`, and until they've grown into it,
   * the browser clamps the write to `scrollHeight - clientHeight`, short of where the pin belongs.
   * So the chase keeps comparing the live `container.scrollTop` against the desired position and
   * re-applying the write while they disagree, bounded by `PIN_SCROLL_MAX_ATTEMPTS` so a layout
   * that never settles can't chase it forever. Reaching the desired position latches it immediately
   * — nothing left to correct — and so does the reader scrolling away mid-chase: the next frame
   * finds `container.scrollTop` no longer matches what this chase itself last wrote, reads that as
   * "no longer mine to move", and latches without writing rather than yanking the view back.
   */
  const measurePin = useCallback(() => {
    const container = scrollContainerRef.current;
    const spacer = spacerRef.current;
    const pin = pinRef.current;
    if (!container || !spacer || !pin) return;

    const target = container.querySelector<HTMLElement>(
      `[data-message-id="${escapeAttribute(pin.messageId)}"]`,
    );
    if (!target) return;

    // Offsets are measured against the container rather than read from `offsetTop`, because a
    // virtualized row is absolutely positioned and would report an offset relative to itself.
    const containerTop = container.getBoundingClientRect().top - container.scrollTop;
    const targetTop = target.getBoundingClientRect().top - containerTop;

    // The content end is the bottom of the scrollable content, not the spacer's own top. V1 can use
    // the latter (`spacer.offsetTop` in `useThreadScroll.ts`) because its spacer is the last child of
    // `.chat-thread`; here the scroll anchor is rendered after it, and the list's `gap-6` sits
    // between the two. Measuring at the spacer's top leaves that 25px out of the reservation, so the
    // thread stays scrollable 25px past the pinned position - which is the sliver of dead space that
    // showed under a reply. Subtracting the spacer's current height from the full scroll height
    // counts every trailing sibling, whatever the list renders after the spacer.
    const spacerHeight = spacer.getBoundingClientRect().height;
    const contentEnd = container.scrollHeight - spacerHeight;

    const needed = container.clientHeight - (contentEnd - targetTop) - PIN_TOP_PADDING;
    const height = Math.max(0, Math.round(needed));
    // Guarded because this also runs from a ResizeObserver watching the container: writing the same
    // height back would be a layout change the observer reports, and the two would feed each other.
    if (spacer.style.height !== `${height}px`) {
      spacer.style.height = `${height}px`;
    }

    if (pin.scrolled) return;

    pin.attempts += 1;

    const desired = Math.max(0, Math.round(targetTop) - PIN_TOP_PADDING);
    const scrolledAwaySinceLastWrite =
      pin.lastWrittenScrollTop !== null && container.scrollTop !== pin.lastWrittenScrollTop;
    // Not locked to the tail any more means the reader (or a scroll elsewhere in this render, e.g.
    // `handleScroll` reacting to a `scroll` event) has already claimed the scroll position; the pin
    // has no more standing to move it than the chase noticing a manual scroll does below.
    const noLongerOurs = scrolledAwaySinceLastWrite || !isLockedToTailRef.current;

    if (noLongerOurs) {
      pin.scrolled = true;
      return;
    }

    if (container.scrollTop !== desired) {
      container.scrollTop = desired;
      // What actually landed, not `desired`: the browser clamps a scroll past `scrollHeight -
      // clientHeight`, and it's that clamped value the next frame has to recognise as "still mine".
      pin.lastWrittenScrollTop = container.scrollTop;
    } else {
      pin.scrolled = true;
      return;
    }

    if (pin.attempts >= PIN_SCROLL_MAX_ATTEMPTS) {
      pin.scrolled = true;
      return;
    }

    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null;
      // The pin may have been retargeted, cleared, or already settled by another caller
      // (render, ResizeObserver) while this frame was pending.
      if (pinRef.current === pin && !pin.scrolled) measurePinRef.current();
    });
  }, [scrollContainerRef, spacerRef]);

  const measurePinRef = useRef(measurePin);
  measurePinRef.current = measurePin;

  useLayoutEffect(measurePin);

  /**
   * Re-measures when the thread changes height without React re-rendering.
   *
   * The reservation is only right for the height the content had when it was last measured, and a
   * reply changes height on its own long after its delta arrived: a markdown block whose lazy chunk
   * resolves, an image that decodes, a code block that re-wraps when the window is resized. Each
   * leaves the spacer reserving room for content that is now there - the visible gap above the
   * composer - until the next delta happens to force a render. V1 has the same problem and answers
   * it the same way, with the ResizeObserver over the thread and its children in `ChatWidget.tsx`.
   *
   * Re-subscribed every render, like the scroll listener above and for the same two reasons: the
   * thread is not mounted until a conversation has messages, so a subscription keyed on stable deps
   * would run once against a null ref and never attach; and re-reading the children each time is
   * what keeps the list's own wrapper observed after the empty state has been replaced.
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => measurePinRef.current());
    observer.observe(container);
    // The rows live in the column the list wraps them in, which is what actually grows; the
    // container's own box is pinned by its flex parent and would report nothing.
    for (const child of Array.from(container.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  });

  return {
    scrollContainerRef,
    anchorRef,
    spacerRef,
    isLockedToTail,
    isAtBottom,
    scrollToTail,
    resetToTail,
    notifyContentUpdate,
    handleScroll,
    pinMessage,
    retargetPin,
    clearPin,
  };
}
