import React, { Suspense, useCallback, useState } from "react";
import { prismTheme } from "@/lib/prismTheme";
import { copyToClipboard } from "@/lib/clipboard";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { IconButton } from "../ui/IconButton";

/**
 * A highlighted code block with a copy button — the plain-fence rendering, with no dispatch on the
 * language.
 *
 * It lives in its own module rather than inside `BlockHandler` because `QuestionsCallout` renders
 * code blocks too, and importing `BlockHandler` from there would close a cycle (`BlockHandler`
 * already imports `QuestionsCallout`). Same reasoning as `questionsContext.ts`.
 */

/** `CodeBlock` is eagerly reachable from the `tendril` entrypoint, so a static import here puts
 * `react-syntax-highlighter` and its ~600 refractor language packs (617 kB) on the initial load. The
 * shape mirrors `markdown/MarkdownCodeBlock.tsx`, which already does this. */
const SyntaxHighlighter = lazyWithRetry(() =>
  import("react-syntax-highlighter").then((mod) => ({ default: mod.Prism })),
);

const CopyIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const codeBlockPreStyle: React.CSSProperties = {
  margin: 0,
  minWidth: 0,
  maxWidth: "100%",
  borderRadius: 0,
  background: "transparent",
  padding: "1rem",
  paddingRight: "3rem",
  overflowX: "auto",
  wordBreak: "normal",
  overflowWrap: "break-word",
};

/** Prism's own name for the markup family, which several fence languages map onto. */
export const normalizeLanguage = (lang: string): string =>
  lang === "xml" || lang === "html" || lang === "svg" ? "markup" : lang;

const CopyButton: React.FC<{ content: string }> = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void copyToClipboard(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <IconButton
      className={`pmv-code-copy${copied ? " pmv-code-copy--copied" : ""}`}
      label="Copy to clipboard"
      tooltip={false}
      size="lg"
      tone="muted"
      variant={copied ? "solid" : "ghost"}
      onClick={handleCopy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
};

interface CodeBlockProps {
  content: string;
  /** Fence language, or undefined for a fence that named none. */
  language?: string;
}

/** The no-language rendering, reused as the Suspense fallback: same geometry as the highlighted
 * output, so the block does not reflow when the highlighter chunk arrives, and the code stays
 * readable and copyable in the meantime. */
const PlainPre: React.FC<{ content: string }> = ({ content }) => (
  <pre style={codeBlockPreStyle}>
    <code>{content}</code>
  </pre>
);

export const CodeBlock: React.FC<CodeBlockProps> = ({ content, language }) => (
  <div className="pmv-code-block">
    <CopyButton content={content} />
    {language ? (
      <Suspense fallback={<PlainPre content={content} />}>
        <SyntaxHighlighter
          style={prismTheme as unknown as { [key: string]: React.CSSProperties }}
          language={normalizeLanguage(language)}
          PreTag="pre"
          customStyle={codeBlockPreStyle}
          wrapLongLines={false}
        >
          {content}
        </SyntaxHighlighter>
      </Suspense>
    ) : (
      <PlainPre content={content} />
    )}
  </div>
);
