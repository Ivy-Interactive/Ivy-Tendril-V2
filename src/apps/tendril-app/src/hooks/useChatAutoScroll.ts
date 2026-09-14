import { useState, useEffect, useLayoutEffect, useRef, useCallback, type RefObject } from "react";

/**
 * Breathing room above a pinned message. The thread supplies the same value as its top padding,
 * so a pinned row lands flush with the top of the viewport.
 */
export const PIN_TOP_PADDING = 10;

interface Pin {
  messageId: string;
  /** The one-off scroll that brings the pinned row to the top has already happened. */
  scrolled: boolean;
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
  autoScrollEnabled: boolean;
  isLockedToTail: boolean;
  isAtBottom: boolean;
  toggleAutoScroll: () => void;
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

  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [isLockedToTail, setIsLockedToTail] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const internalAnchorRef = useRef<HTMLDivElement | null>(null);
  const internalSpacerRef = useRef<HTMLDivElement | null>(null);

  const scrollContainerRef = externalContainerRef ?? internalContainerRef;
  const anchorRef = externalAnchorRef ?? internalAnchorRef;
  const spacerRef = externalSpacerRef ?? internalSpacerRef;
  const pinRef = useRef<Pin | null>(null);

  const autoScrollEnabledRef = useRef(autoScrollEnabled);
  autoScrollEnabledRef.current = autoScrollEnabled;

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

  const toggleAutoScroll = useCallback(() => {
    setAutoScrollEnabled((prev) => {
      const next = !prev;
      if (next) {
        const container = scrollContainerRef.current;
        const atBottom = container ? checkIsAtBottom(container) : true;
        if (atBottom) {
          setIsLockedToTail(true);
          setIsAtBottom(true);
          if (anchorRef.current) {
            anchorRef.current.scrollIntoView?.({ behavior: "auto" });
          } else if (container) {
            container.scrollTop = container.scrollHeight;
          }
        }
      }
      return next;
    });
  }, [checkIsAtBottom, scrollContainerRef, anchorRef]);

  const notifyContentUpdate = useCallback(() => {
    if (autoScrollEnabledRef.current && isLockedToTailRef.current) {
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
    pinRef.current = { messageId, scrolled: false };
    setIsLockedToTail(true);
    setIsAtBottom(true);
  }, []);

  /** The pinned message was replaced by its server-side copy; keep the pin on the new row. */
  const retargetPin = useCallback((fromMessageId: string, toMessageId: string) => {
    const pin = pinRef.current;
    if (pin && pin.messageId === fromMessageId) {
      pinRef.current = { ...pin, messageId: toMessageId };
    }
  }, []);

  const clearPin = useCallback(() => {
    pinRef.current = null;
    const spacer = spacerRef.current;
    if (spacer) spacer.style.height = "0px";
  }, [spacerRef]);

  useLayoutEffect(() => {
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
    const contentEnd = spacer.getBoundingClientRect().top - containerTop;

    const needed = container.clientHeight - (contentEnd - targetTop) - PIN_TOP_PADDING;
    spacer.style.height = `${Math.max(0, Math.round(needed))}px`;

    if (!pin.scrolled) {
      pin.scrolled = true;
      container.scrollTop = Math.max(0, Math.round(targetTop - PIN_TOP_PADDING));
    }
  });

  return {
    scrollContainerRef,
    anchorRef,
    spacerRef,
    autoScrollEnabled,
    isLockedToTail,
    isAtBottom,
    toggleAutoScroll,
    scrollToTail,
    resetToTail,
    notifyContentUpdate,
    handleScroll,
    pinMessage,
    retargetPin,
    clearPin,
  };
}

export default useChatAutoScroll;
