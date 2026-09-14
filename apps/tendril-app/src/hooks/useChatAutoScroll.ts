import { useState, useEffect, useRef, useCallback, type RefObject } from "react";

export interface UseChatAutoScrollOptions {
  threshold?: number;
  content?: unknown;
  isGenerating?: boolean;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  anchorRef?: RefObject<HTMLDivElement | null>;
}

export interface UseChatAutoScrollReturn {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  anchorRef: RefObject<HTMLDivElement | null>;
  autoScrollEnabled: boolean;
  isLockedToTail: boolean;
  isAtBottom: boolean;
  toggleAutoScroll: () => void;
  scrollToTail: (smooth?: boolean) => void;
  resetToTail: () => void;
  notifyContentUpdate: () => void;
  handleScroll: () => void;
}

export function useChatAutoScroll(options: UseChatAutoScrollOptions = {}): UseChatAutoScrollReturn {
  const {
    threshold = 32,
    content,
    isGenerating,
    scrollContainerRef: externalContainerRef,
    anchorRef: externalAnchorRef,
  } = options;

  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [isLockedToTail, setIsLockedToTail] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const internalAnchorRef = useRef<HTMLDivElement | null>(null);

  const scrollContainerRef = externalContainerRef ?? internalContainerRef;
  const anchorRef = externalAnchorRef ?? internalAnchorRef;

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

  return {
    scrollContainerRef,
    anchorRef,
    autoScrollEnabled,
    isLockedToTail,
    isAtBottom,
    toggleAutoScroll,
    scrollToTail,
    resetToTail,
    notifyContentUpdate,
    handleScroll,
  };
}

export default useChatAutoScroll;
