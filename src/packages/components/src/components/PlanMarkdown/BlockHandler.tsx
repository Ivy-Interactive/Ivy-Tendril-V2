import React, { lazy, Suspense, useContext } from "react";
import { extractTextContent } from "@/lib/markdown-utils";
import { CodeBlock } from "./CodeBlock";
import { QuestionsCallout } from "./QuestionsCallout";
import { QuestionsAnswerContext, QuestionsSubmitContext } from "./questionsContext";
import { WireframeBlock } from "./WireframeBlock";
import { useTranslation } from "@/i18n/uiPlanWorkspace";

/** `questions`, or `questions_<n>` once `tagQuestionBlocks` has stamped the block's index on it. */
const QUESTIONS_LANG = /^questions(?:_(\d+))?$/;

const MermaidRenderer = lazy(() =>
  import("./MermaidRenderer").then((m) => ({ default: m.MermaidRenderer })),
);
const GraphvizRenderer = lazy(() =>
  import("./GraphvizRenderer").then((m) => ({ default: m.GraphvizRenderer })),
);

export const BlockHandler: React.FC<React.HTMLAttributes<HTMLElement>> = ({
  className,
  children,
  style: _style,
  ...rest
}) => {
  const match = /language-(\w+)/.exec(String(className || ""));
  const text = extractTextContent(children);
  const content = text.replace(/\n$/, "");
  const onAnswer = useContext(QuestionsAnswerContext);
  const onSubmit = useContext(QuestionsSubmitContext);
  const { t } = useTranslation("uiPlanWorkspace");

  if (match) {
    const lang = match[1];

    if (lang === "mermaid") {
      return (
        <Suspense
          fallback={
            <div className="pmv-diagram-loading">
              <span>{t("diagram.loading")}</span>
            </div>
          }
        >
          <MermaidRenderer content={content} />
        </Suspense>
      );
    }

    // A live preview of the plan's wireframe. Never its source and never a screenshot:
    // screenshots exist for the agent that made it to check its own work, and the reviewer sees
    // the real thing, hot reloading while the agent edits it.
    if (lang === "wireframe") {
      return <WireframeBlock content={content} />;
    }

    if (lang === "graphviz" || lang === "dot") {
      return (
        <Suspense
          fallback={
            <div className="pmv-diagram-loading">
              <span>{t("diagram.loading")}</span>
            </div>
          }
        >
          <GraphvizRenderer content={content} />
        </Suspense>
      );
    }

    if (QUESTIONS_LANG.test(lang)) {
      return <QuestionsCallout content={content} onAnswer={onAnswer} onSubmit={onSubmit} />;
    }

    return <CodeBlock content={content} language={lang} />;
  }

  // No language match - check if block-level (multi-line) or inline
  const isBlock = text.includes("\n");
  if (isBlock) {
    return <CodeBlock content={content} />;
  }

  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
};
