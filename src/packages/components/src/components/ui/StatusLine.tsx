import React from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { Tooltip } from "./TuiTooltip";
import { useElapsedMs } from "./use-elapsed";
import { formatNumber, i18n, useTranslation } from "@/i18n/uiCommon";
import "./ui.css";

export interface StatusLineProps {
  /** What the agent is doing, e.g. "Waiting for Claude…". */
  statusText: string;
  isComplete?: boolean;
  showIcon?: boolean;
  /**
   * When the run started (ISO timestamp or epoch ms). While the run is live the elapsed time
   * ticks once a second; `elapsedMs` freezes it for a finished run.
   */
  startedAt?: string | number | null;
  elapsedMs?: number | null;
  /** Tokens consumed so far; hidden when null. */
  tokens?: number | null;
  /** Marks the figure as derived from the stream rather than reported, rendering "~16.8k". */
  tokensEstimated?: boolean;
  className?: string;
}

/**
 * "45s", "12m 22s", "1h 3m" — the shape Claude Code's own status line uses. The unit letters come
 * from the catalog, in the language current when it is called.
 */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return i18n.t("uiCommon:format.duration.hoursMinutes", { hours, minutes });
  if (minutes > 0) return i18n.t("uiCommon:format.duration.minutesSeconds", { minutes, seconds });
  return i18n.t("uiCommon:format.duration.seconds", { seconds });
};

/**
 * One decimal with a trailing ".0" dropped ("16.8", "17"), in the current language. Rounded by
 * `toFixed` before `Intl` spells it, so the figure is the one `toFixed` always printed.
 */
const oneDecimal = (n: number): string =>
  formatNumber(Number(n.toFixed(1)), { maximumFractionDigits: 1, useGrouping: false });

/** Token counts from here up are abbreviated ("1k", "16.8k", "1.2M"). */
const ABBREVIATED_FROM = 1000;

/** "842", "16.8k", "1.2M". */
export const formatTokenCount = (count: number): string => {
  const value = Math.max(0, Math.round(count));
  if (value < ABBREVIATED_FROM) return formatNumber(value, { useGrouping: false });
  if (value < 1_000_000) {
    return i18n.t("uiCommon:format.tokenCount.thousands", { value: oneDecimal(value / 1000) });
  }
  return i18n.t("uiCommon:format.tokenCount.millions", { value: oneDecimal(value / 1_000_000) });
};

/**
 * The bundle's one agent status line: a spinner, the live elapsed time and token count, and
 * the status message — `12m 22s · 16.8k tokens · Waiting for Claude…`. It is what every
 * surface that shows a thinking agent renders, so the chat and the agent viewer stay in step.
 */
export const StatusLine: React.FC<StatusLineProps> = ({
  statusText,
  isComplete = false,
  showIcon = true,
  startedAt,
  elapsedMs,
  tokens,
  tokensEstimated = false,
  className = "",
}) => {
  // Subscribes this line to the language, so the formatted figures below re-render with it.
  const { t } = useTranslation("uiCommon");
  const elapsed = useElapsedMs(startedAt, elapsedMs, isComplete);

  const parts: React.ReactNode[] = [];
  if (elapsed != null) {
    parts.push(
      <span key="elapsed" className="tui-status-elapsed">
        {formatElapsed(elapsed)}
      </span>,
    );
  }
  if (tokens != null && tokens > 0) {
    // Below the abbreviation the figure is the count, so "tokens" is a plural of it. An abbreviated
    // figure ("16.8k") is not: there the noun follows the thousand or million, in one fixed form
    // (Russian "16,8 тыс. токенов", whatever the last digit of the real count is).
    const count = Math.max(0, Math.round(tokens));
    const value = formatTokenCount(count);
    let text: string;
    if (count < ABBREVIATED_FROM) {
      text = tokensEstimated
        ? t("statusLine.tokensEstimated", { value, count })
        : t("statusLine.tokens", { value, count });
    } else {
      text = tokensEstimated
        ? t("statusLine.tokensAbbreviatedEstimated", { value })
        : t("statusLine.tokensAbbreviated", { value });
    }
    parts.push(
      tokensEstimated ? (
        <Tooltip key="tokens" content={t("statusLine.estimatedTooltip")}>
          <span className="tui-status-tokens">{text}</span>
        </Tooltip>
      ) : (
        <span key="tokens" className="tui-status-tokens">
          {text}
        </span>
      ),
    );
  }

  return (
    <div
      className={`tui-status ${className}`.trim()}
      data-complete={isComplete}
      role="status"
      aria-live="polite"
    >
      {showIcon && (
        <span className="tui-status-icon" data-spin={!isComplete} aria-hidden="true">
          {isComplete ? <CircleCheck size={14} /> : <LoaderCircle size={14} />}
        </span>
      )}
      {/* The elapsed time re-renders every second; inside the live region it would be read out
          again every second, so only the message itself is announced. */}
      {parts.length > 0 && (
        <span className="tui-status-metrics" aria-hidden="true">
          {parts.map((part, index) => (
            <React.Fragment key={index}>
              {part}
              <span className="tui-status-sep" aria-hidden="true">
                ·
              </span>
            </React.Fragment>
          ))}
        </span>
      )}
      <span className="tui-status-text">{statusText}</span>
    </div>
  );
};
