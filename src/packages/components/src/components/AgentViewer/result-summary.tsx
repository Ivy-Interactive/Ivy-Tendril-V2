import React from "react";
import Markdown from "react-markdown";
import type { ResultWire } from "./types.ts";
import { BlockHandler } from "../PlanMarkdown/BlockHandler.tsx";
import { getMarkdownPlugins } from "@/lib/math";
import { useMathReady } from "@/hooks/use-math-ready";
import { AlertBlockquote } from "../PlanMarkdown/AlertBlockquote.tsx";
import { tagQuestionBlocks } from "../PlanMarkdown/questionsSource.ts";
import { QuestionsAnswerContext } from "../PlanMarkdown/questionsContext.ts";
import { useFormatters, useTranslation } from "@/i18n/uiShell";
import { formatRunCost } from "./metrics-footer.tsx";

/**
 * Seconds to one decimal, ungrouped, rounded by `toFixed` first (see `formatRunCost` for why): the
 * figures `(ms / 1000).toFixed(1)` printed, in the current language's digits.
 */
const SECONDS_FORMAT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: false,
};
const formatSeconds = (format: ReturnType<typeof useFormatters>, ms: number): string =>
  format.number(Number((ms / 1000).toFixed(1)), SECONDS_FORMAT);

interface ResultSummaryProps {
  wire: ResultWire;
}

export const ResultSummary: React.FC<ResultSummaryProps> = ({ wire }) => {
  // KaTeX loads on demand, so a result containing maths renders its TeX source first and typesets it
  // on the render this subscription triggers. See `src/hooks/use-math-ready.ts`.
  useMathReady();
  const { t } = useTranslation("uiShell");
  const format = useFormatters();

  const isError = !wire.is_success;
  const usage = wire.usage;

  const statsList: React.ReactNode[] = [];
  if (usage?.cost_usd != null && usage.cost_usd > 0) {
    // A cost Tendril worked out from the token counts carries the "~" an estimate always carries here
    // and in `JobsView`, so a figure nobody was billed cannot be read as one they were.
    const estimated = usage.cost_source === "estimated";
    const cost = formatRunCost(usage.cost_usd);
    statsList.push(
      <span
        key="cost"
        data-estimated={estimated}
        title={
          estimated
            ? t("resultSummary.cost.estimatedTooltip")
            : t("resultSummary.cost.billedTooltip")
        }
      >
        {estimated
          ? t("resultSummary.cost.estimated", { cost })
          : t("resultSummary.cost.billed", { cost })}
      </span>,
    );
  }
  if (wire.duration_ms != null && wire.duration_ms > 0) {
    statsList.push(
      <span key="dur">
        {t("resultSummary.duration", { seconds: formatSeconds(format, wire.duration_ms) })}
      </span>,
    );
  }
  if (usage != null && (usage.input_tokens > 0 || usage.output_tokens > 0)) {
    statsList.push(
      <span key="tok">
        {t("resultSummary.tokens", {
          input: format.number(usage.input_tokens),
          output: format.number(usage.output_tokens),
        })}
      </span>,
    );
  }
  // Cache traffic is most of a long run's bill — 640k of a 648k-token run — so a stats row that omits
  // it makes the cost beside it look unaccountable.
  if (usage != null && (usage.cache_read_tokens > 0 || usage.cache_write_tokens > 0)) {
    statsList.push(
      <span key="cache">
        {t("resultSummary.cache", {
          read: format.number(usage.cache_read_tokens),
          write: format.number(usage.cache_write_tokens),
        })}
      </span>,
    );
  }
  if (usage?.premium_requests != null && usage.premium_requests > 0) {
    statsList.push(
      <span key="prem">{t("resultSummary.premium", { value: usage.premium_requests })}</span>,
    );
  }
  if (wire.exit_code != null && wire.exit_code !== 0) {
    statsList.push(<span key="exit">{t("resultSummary.exitCode", { code: wire.exit_code })}</span>);
  }
  if (wire.permission_denials != null && wire.permission_denials.length > 0) {
    statsList.push(
      <span key="denied">
        {t("resultSummary.denied", { value: wire.permission_denials.length })}
      </span>,
    );
  }

  const hasResponse = Boolean(wire.response && wire.response.trim().length > 0);
  const errorText = wire.error?.trim();
  const hasError = Boolean(errorText);

  const taggedResponse = hasResponse ? tagQuestionBlocks(wire.response!) : "";
  const plugins = getMarkdownPlugins(taggedResponse);

  // Return null if there is nothing to render, preventing empty container boxes
  if (!isError && !hasResponse && statsList.length === 0) {
    return null;
  }

  return (
    <div className={`aov-result ${isError ? "error" : ""}`}>
      {isError && (
        <div className="aov-result-header">
          <span className="aov-result-title">{t("resultSummary.errorTitle")}</span>
        </div>
      )}
      {/* What went wrong, which V1's `result-summary.tsx` renders and V2's port dropped: a failed run
          showed a bare "❌ Error" and nothing else, so the reason the agent gave for stopping — an idle
          timeout, an exit code, an auth failure — was on the wire and never on the screen. A failure
          with neither a reason nor an answer says the one thing that can still be said about it. */}
      {isError && (hasError || !hasResponse) && (
        <div className="aov-result-body aov-result-error">
          {hasError
            ? errorText
            : wire.exit_code == null
              ? t("resultSummary.terminatedUnknownCode")
              : t("resultSummary.terminated", { code: wire.exit_code })}
        </div>
      )}
      {hasResponse && (
        <div className="aov-markdown aov-result-body">
          <QuestionsAnswerContext.Provider value={undefined}>
            <Markdown
              remarkPlugins={plugins.remarkPlugins}
              rehypePlugins={plugins.rehypePlugins}
              components={{
                code: BlockHandler,
                blockquote: AlertBlockquote,
                pre: ({ children }) => <>{children}</>,
              }}
            >
              {taggedResponse}
            </Markdown>
          </QuestionsAnswerContext.Provider>
        </div>
      )}
      {statsList.length > 0 && <div className="aov-result-stats">{statsList}</div>}
    </div>
  );
};
