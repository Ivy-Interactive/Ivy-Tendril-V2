import React, { Suspense, useCallback, useState } from "react";
import { prismTheme } from "@/lib/prismTheme";
import { copyToClipboard } from "@/lib/clipboard";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { IconButton } from "../ui/IconButton";
import { useTranslation } from "@/i18n/uiPlanWorkspace";

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

/**
 * `codeBlockPreStyle` with the horizontal scroller traded for soft wrapping — see `wrapLines`. The
 * overflow has to go with it: a `pre` that both wraps and scrolls keeps a scrollbar it can never use.
 */
export const wrappedCodeBlockPreStyle: React.CSSProperties = {
  ...codeBlockPreStyle,
  whiteSpace: "pre-wrap",
  overflowX: "hidden",
  wordBreak: "break-word",
};

/** Prism's own name for the markup family, which several fence languages map onto. */
export const normalizeLanguage = (lang: string): string =>
  lang === "xml" || lang === "html" || lang === "svg" ? "markup" : lang;

const CopyButton: React.FC<{ content: string }> = ({ content }) => {
  const { t } = useTranslation("uiPlanWorkspace");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyToClipboard(content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err: unknown) => {
        console.error("Copy failed:", err);
      });
  }, [content]);

  return (
    <IconButton
      className={`pmv-code-copy${copied ? " pmv-code-copy--copied" : ""}`}
      label={t("codeBlock.copy")}
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
  /**
   * Soft-wrap long lines instead of scrolling them sideways — the legacy widget's `.WrapLines()`.
   *
   * Off by default, because a markdown fence is usually code, where a wrapped line is a line that
   * lies about its indentation. On for prose held in a code block — an agent prompt, say — where
   * there is no column structure to preserve and a horizontal scrollbar just hides the text.
   */
  wrapLines?: boolean;
}

/** The no-language rendering, reused as the Suspense fallback: same geometry as the highlighted
 * output, so the block does not reflow when the highlighter chunk arrives, and the code stays
 * readable and copyable in the meantime. */
const PlainPre: React.FC<{ content: string; wrapLines?: boolean }> = ({ content, wrapLines }) => (
  <pre style={wrapLines ? wrappedCodeBlockPreStyle : codeBlockPreStyle}>
    <code>{content}</code>
  </pre>
);

export const CodeBlock: React.FC<CodeBlockProps> = ({ content, language, wrapLines }) => (
  <div className="pmv-code-block">
    <CopyButton content={content} />
    {language ? (
      <Suspense fallback={<PlainPre content={content} wrapLines={wrapLines} />}>
        <SyntaxHighlighter
          style={prismTheme as unknown as { [key: string]: React.CSSProperties }}
          language={normalizeLanguage(language)}
          PreTag="pre"
          customStyle={wrapLines ? wrappedCodeBlockPreStyle : codeBlockPreStyle}
          wrapLongLines={Boolean(wrapLines)}
        >
          {content}
        </SyntaxHighlighter>
      </Suspense>
    ) : (
      <PlainPre content={content} wrapLines={wrapLines} />
    )}
  </div>
);
