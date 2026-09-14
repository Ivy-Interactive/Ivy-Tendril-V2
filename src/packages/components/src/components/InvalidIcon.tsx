import type React from "react";
import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { cn } from "@/lib/utils";

export interface InvalidIconProps {
  message: string;
  className?: string;
  iconClassName?: string;
}

export const InvalidIcon: React.FC<InvalidIconProps> = ({ message, className, iconClassName }) => {
  return (
    <TooltipProvider>
      <Tooltip className="contents">
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            data-invalid-icon="true"
            aria-label={message || "Validation error"}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 shadow-none outline-none leading-none",
              "pointer-events-auto focus-visible:ring-1 focus-visible:ring-ring",
              className,
            )}
          >
            <InfoIcon
              className={cn(
                "block shrink-0 text-destructive transition-colors duration-200 hover:text-destructive/80",
                iconClassName ?? "size-4",
              )}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent className="bg-popover text-popover-foreground shadow-md">
          <div className="max-w-60">{message}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default InvalidIcon;
