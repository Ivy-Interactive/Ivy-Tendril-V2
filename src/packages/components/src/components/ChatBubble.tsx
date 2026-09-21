import type * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MessageLoading } from "@/components/MessageLoading";

export interface ChatBubbleProps {
  variant?: "sent" | "received";
  layout?: "default" | "ai";
  className?: string;
  children: React.ReactNode;
}

/**
 * One row of the thread. A sent message is pushed to the trailing edge and keeps its bubble
 * shape; a received one starts at the leading edge and is free to take the whole row, because an
 * agent turn carries structured content (code blocks, tables, question blocks) that a bubble would
 * squeeze. Vertical rhythm belongs to the thread's own gap, not to the row.
 */
export function ChatBubble({ variant = "received", className, children }: ChatBubbleProps) {
  return (
    <div
      className={cn(
        "group flex w-full min-w-0",
        variant === "sent" ? "flex-row-reverse" : "justify-start",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ChatBubbleMessageProps {
  variant?: "sent" | "received";
  isLoading?: boolean;
  className?: string;
  /** Hover text for the bubble, e.g. the message's timestamp. */
  title?: string;
  children?: React.ReactNode;
}

/**
 * The message body. Sent: a primary-filled bubble, squared off at the corner nearest the sender,
 * never wider than four fifths of the row. Received: no surface at all, so the agent's prose sits
 * on the page like a document.
 */
export function ChatBubbleMessage({
  variant = "received",
  isLoading,
  className,
  title,
  children,
}: ChatBubbleMessageProps) {
  return (
    <div
      title={title}
      className={cn(
        "text-large-body",
        variant === "sent"
          ? "flex max-w-[80%] flex-col items-end gap-2.5 rounded-2xl rounded-tr-none bg-primary p-4 text-primary-foreground wrap-anywhere"
          : "w-full min-w-0 max-w-full leading-relaxed text-foreground",
        className,
      )}
    >
      {isLoading ? (
        <div className="flex items-center gap-x-2">
          <MessageLoading />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export interface ChatBubbleActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ChatBubbleAction({ icon, onClick, className, ...props }: ChatBubbleActionProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-6", className)}
      onClick={onClick}
      {...props}
    >
      {icon}
    </Button>
  );
}

export interface ChatBubbleActionWrapperProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * The row's trailing meta line: small, muted and out of the way until the row is hovered or
 * focused, so a long thread reads as content rather than as rows of buttons.
 */
export function ChatBubbleActionWrapper({ className, children }: ChatBubbleActionWrapperProps) {
  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-2.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}
