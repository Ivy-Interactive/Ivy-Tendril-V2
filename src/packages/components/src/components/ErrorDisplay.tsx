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
    <div className="flex flex-col h-full gap-4">
      <div className="shrink-0">
        {title && (
          <div>
            <h4 className="text-sm font-medium mb-2">Type</h4>
            <p>{title}</p>
          </div>
        )}

        {message && (
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">Message</h4>
            <p>{message}</p>
          </div>
        )}
      </div>

      {stackTrace && (
        <div className="flex-1 min-h-0">
          <h4 className="text-sm font-medium mb-2">Stack Trace</h4>
          <div tabIndex={0} className="w-full overflow-auto border border-border rounded-md">
            <Suspense fallback={<pre className="p-4 font-mono text-sm">{stackTrace}</pre>}>
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
