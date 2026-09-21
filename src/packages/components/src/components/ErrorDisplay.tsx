import type React from "react";
import { Suspense, useState } from "react";
import { Button } from "./ui/button";
import { ClipboardCopy, Check } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { prismTheme } from "@/lib/prismTheme";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

/** `ErrorDisplay` is exported from both `index.ts` and `renderers.ts`, so a static import here is a
 * second eager path into the 617 kB syntax-highlighter chunk. Same shape as `PlanMarkdown/CodeBlock`. */
const SyntaxHighlighter = lazyWithRetry(() =>
  import("react-syntax-highlighter").then((mod) => ({ default: mod.Prism })),
);

export interface ErrorDisplayProps {
  title?: string | null;
  message?: string | null;
  stackTrace?: string | null;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ title, message, stackTrace }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const errorDetails = [
      title && `Title: ${title}`,
      message && `Message: ${message}`,
      stackTrace && `Stack Trace:\n${stackTrace}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    copyToClipboard(errorDetails)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err: unknown) => {
        console.error("Copy failed:", err);
      });
  };

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 gap-4">
      <div className="shrink-0 min-w-0">
        {title && (
          <div>
            <h4 className="text-sm font-medium mb-2">Type</h4>
            {/* Exception type names are single unbroken tokens (`System.InvalidOperationException`),
             * which have no break opportunity of their own: without `break-words` one widens the
             * whole card past its container and scrolls the page sideways. */}
            <p className="break-words">{title}</p>
          </div>
        )}

        {message && (
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">Message</h4>
            {/* Same reason as the type above - a message is often one long token (a URL, a path, a
             * serialized payload) rather than prose that wraps on its own spaces. */}
            <p className="break-words">{message}</p>
          </div>
        )}
      </div>

      {stackTrace && (
        /* A flex column, not a plain block: the heading and the scroller have to divide this
         * section's height between them. As a block, the scroller below had no height to resolve
         * `flex-1` against and sized to its content instead - a 470px box inside a 148px section -
         * so it spilled out the bottom and painted straight over the Copy Details row. */
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <h4 className="text-sm font-medium mb-2 shrink-0">Stack Trace</h4>
          {/* `flex-1 min-h-0` is what actually bounds this box to the space the section has left,
           * and only a bounded box can scroll - `overflow-auto` on a content-sized box never
           * engages. `min-h-0` overrides the `min-height: auto` a flex item gets by default, which
           * would otherwise floor the box at its content height and re-create the overflow.
           * The `break-words` descendants cover the highlighter's own <pre>/<code>, whose inline
           * theme styles set no overflow-wrap: `wrapLongLines` only sets `pre-wrap`, which wraps at
           * spaces and so leaves a long unbroken file path scrolling sideways forever. */}
          <div
            tabIndex={0}
            className="w-full flex-1 min-h-0 overflow-auto border border-border rounded-md [&_pre]:break-words [&_code]:break-words"
          >
            <Suspense
              fallback={
                <pre className="p-4 font-mono text-sm whitespace-pre-wrap break-words">
                  {stackTrace}
                </pre>
              }
            >
              <SyntaxHighlighter
                language="csharp"
                style={prismTheme}
                wrapLongLines={true}
                showLineNumbers={false}
              >
                {stackTrace}
              </SyntaxHighlighter>
            </Suspense>
          </div>
        </div>
      )}

      <div className="shrink-0 pt-4 border-t">
        <Button onClick={handleCopy} className="flex items-center gap-2" variant="outline">
          {copied ? (
            <Check className="size-4 text-primary animate-in fade-in duration-500" />
          ) : (
            <ClipboardCopy className="size-4" />
          )}
          Copy Details
        </Button>
      </div>
    </div>
  );
};
