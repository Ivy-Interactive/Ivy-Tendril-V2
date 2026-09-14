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

export function ChatBubble({ variant = "received", className, children }: ChatBubbleProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 mb-4",
        variant === "sent" && "flex-row-reverse",
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
  children?: React.ReactNode;
}

export function ChatBubbleMessage({
  variant = "received",
  isLoading,
  className,
  children,
}: ChatBubbleMessageProps) {
  return (
    <div
      className={cn(
        "rounded-box p-3 text-large-body",
        variant === "sent" ? "bg-primary text-primary-foreground" : "bg-muted",
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

export function ChatBubbleActionWrapper({ className, children }: ChatBubbleActionWrapperProps) {
  return <div className={cn("flex items-center gap-1 mt-2", className)}>{children}</div>;
}

export default ChatBubble;
