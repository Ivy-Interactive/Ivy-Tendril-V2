import * as React from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAutoScroll } from "@/hooks/use-auto-scroll";

export interface ChatMessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  smooth?: boolean;
  /** Keep the list pinned to the newest message as content grows. Set `false` when the consumer owns scrolling. Defaults to `true`. */
  enableAutoScroll?: boolean;
  /** Render the built-in scroll-to-bottom button while the list is scrolled away from the bottom. Defaults to `true`. */
  showScrollButton?: boolean;
}

const ChatMessageList = React.forwardRef<HTMLDivElement, ChatMessageListProps>(
  (
    {
      className,
      children,
      smooth = false,
      enableAutoScroll = true,
      showScrollButton = true,
      ...props
    },
    ref,
  ) => {
    const { scrollRef, isAtBottom, scrollToBottom, disableAutoScroll } = useAutoScroll({
      smooth,
      content: children,
      enabled: enableAutoScroll,
    });

    React.useImperativeHandle(ref, () => scrollRef.current as HTMLDivElement);

    return (
      <div className="relative w-full h-full">
        <div
          tabIndex={0}
          className={`flex flex-col w-full h-full overflow-y-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset ${className || ""}`}
          ref={scrollRef}
          onWheel={disableAutoScroll}
          onTouchMove={disableAutoScroll}
          {...props}
        >
          {/* The thread is a single measured column: the scroller runs edge to edge, the content
              is capped and centred, and the inset lives here rather than on the scroller. Top
              padding is left to the consumer, who may need to account for it in its own scroll
              geometry (as ChatView.tsx does for the message-pin math). */}
          <div className="flex grow shrink-0 flex-col gap-6 w-full max-w-3xl mx-auto px-2.5">
            {children}
          </div>
        </div>

        {showScrollButton && !isAtBottom && (
          <Button
            onClick={() => {
              scrollToBottom();
            }}
            size="icon"
            variant="outline"
            className="absolute bottom-2 left-1/2 transform -translate-x-1/2 inline-flex rounded-full shadow-md"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="size-4" />
          </Button>
        )}
      </div>
    );
  },
);

ChatMessageList.displayName = "ChatMessageList";

export { ChatMessageList };
