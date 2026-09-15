import * as React from "react";
import { cn } from "@/lib/utils";

export type ChatInputProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * The composer's text field: a bare textarea that grows with its content up to ten lines and then
 * scrolls, with no surface of its own. The composer draws the box around it, so this has to be a
 * direct flex child of that row rather than a wrapped input control.
 */
const ChatInput = React.forwardRef<HTMLTextAreaElement, ChatInputProps>(
  ({ className, ...props }, ref) => (
    <textarea
      autoComplete="off"
      ref={ref}
      name="message"
      rows={1}
      className={cn(
        "min-h-[32px] max-h-[200px] min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1.5 text-large-body leading-5 text-foreground shadow-none outline-none placeholder:text-foreground placeholder:opacity-60 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
ChatInput.displayName = "ChatInput";

export { ChatInput };
export default ChatInput;
