import React, { useState, useCallback } from "react";

export const BlockHandler: React.FC<React.HTMLAttributes<HTMLElement>> = ({
  className,
  children,
  ...rest
}) => {
  const match = /language-(\w+)/.exec(String(className || ""));
  const textContent =
    typeof children === "string"
      ? children
      : React.Children.toArray(children)
          .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
          .join("");
  const content = textContent.replace(/\n$/, "");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [content]);

  const isMultiLine = textContent.includes("\n");

  if (match || isMultiLine) {
    const lang = match ? match[1] : "";
    return (
      <div className="relative group my-2 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-950 border-b border-neutral-800 text-xs text-neutral-400 font-mono">
          <span>{lang || "code"}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="hover:text-neutral-200 text-xs px-2 py-0.5 rounded bg-neutral-800/60 hover:bg-neutral-800 transition-colors"
            aria-label="Copy code"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="p-3 overflow-x-auto text-sm font-mono leading-relaxed m-0">
          <code>{content}</code>
        </pre>
      </div>
    );
  }

  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
};
