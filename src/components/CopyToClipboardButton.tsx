import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { Densities } from "@/types/density";
import { cva } from "class-variance-authority";
import { controlSize } from "@/components/ui/density-scale";
import { useDensity } from "@/contexts/density-context";
import type React from "react";

const copyIconVariant = cva("", {
  variants: {
    density: {
      Small: "size-3",
      Medium: "size-4",
      Large: "size-5",
    },
  },
  defaultVariants: {
    density: "Medium",
  },
});

const copyButtonSizeVariant = cva(
  "rounded bg-transparent hover:bg-accent focus:outline-none cursor-pointer flex items-center justify-center",
  {
    variants: {
      density: {
        Small: controlSize.Small,
        Medium: controlSize.Medium,
        Large: controlSize.Large,
      },
    },
    defaultVariants: {
      density: "Medium",
    },
  },
);

export interface CopyToClipboardButtonProps {
  textToCopy?: string;
  label?: string;
  "aria-label"?: string;
  density?: Densities;
  className?: string;
}

export const CopyToClipboardButton: React.FC<CopyToClipboardButtonProps> = ({
  textToCopy = "",
  label = "",
  "aria-label": ariaLabel,
  density,
  className,
}) => {
  const [copied, setCopied] = useState(false);
  const effectiveDensity = density ?? useDensity();

  const handleCopy = async () => {
    try {
      await copyToClipboard(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const isIconOnly = !label;

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel || "Copy to clipboard"}
      className={cn(
        isIconOnly
          ? cn(
              copyButtonSizeVariant({ density: effectiveDensity }),
              !copied && "text-muted-foreground hover:text-foreground",
              copied &&
                "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus-visible:ring-primary",
            )
          : "flex items-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 ease-in-out cursor-pointer hover:bg-accent hover:shadow-sm border-0",
        !isIconOnly &&
          (copied
            ? "bg-primary text-primary-foreground"
            : "bg-transparent text-muted-foreground hover:text-foreground"),
        className,
      )}
    >
      <span className={cn("relative", copyIconVariant({ density: effectiveDensity }))}>
        <span
          className={cn(
            "absolute inset-0 transform transition-transform duration-200",
            copied ? "scale-0" : "scale-100",
          )}
        >
          <Copy className={copyIconVariant({ density: effectiveDensity })} />
        </span>
        <span
          className={cn(
            "absolute inset-0 transform transition-transform duration-200",
            copied ? "scale-100" : "scale-0",
          )}
        >
          <Check className={copyIconVariant({ density: effectiveDensity })} />
        </span>
      </span>
      {label && <span className="text-small-label">{copied ? "Copied!" : label}</span>}
    </button>
  );
};

export default CopyToClipboardButton;
