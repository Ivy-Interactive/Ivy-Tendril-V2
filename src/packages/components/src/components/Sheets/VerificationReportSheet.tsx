import React from "react";
import { Badge } from "../ui/badge";
import { Callout } from "../ui/callout";
import { SheetPanel } from "../ui/sheet-panel";
import { PlanMarkdown } from "../PlanMarkdown/PlanMarkdown";
import { useTranslation, type TFunction } from "@/i18n/uiReview";

/** A verification's outcome, as `plan.yaml` and the report's frontmatter record it. */
export type VerificationReportStatus = "Pending" | "Pass" | "Fail" | "Skipped";

/**
 * `Constants.VerificationStatusBadgeVariants`: Pass is Success, Fail is Destructive, Pending and
 * Skipped are Outline - the same mapping the app's verification rows use.
 */
const STATUS_VARIANT: Record<VerificationReportStatus, "success" | "destructive" | "outline"> = {
  Pass: "success",
  Fail: "destructive",
  Pending: "outline",
  Skipped: "outline",
};

const STATUS_KEYS = {
  Pass: "verificationReport.status.pass",
  Fail: "verificationReport.status.fail",
  Pending: "verificationReport.status.pending",
  Skipped: "verificationReport.status.skipped",
} as const satisfies Record<VerificationReportStatus, string>;

/** The outcome as the reader reads it; one this build does not know is shown as it is. */
function statusLabel(t: TFunction, status: string): string {
  return Object.hasOwn(STATUS_KEYS, status)
    ? t(STATUS_KEYS[status as VerificationReportStatus])
    : status;
}

/** A report as the sheet renders it: the app's `VerificationReport`, which passes straight through. */
export interface VerificationReportData {
  name: string;
  /** Raw markdown of `<planFolder>/Verification/<name>.md`. */
  content: string;
  /** `result` from the report's frontmatter, when present. */
  result?: VerificationReportStatus;
  /** `date` from the report's frontmatter, when present. */
  date?: string;
}

export interface VerificationReportSheetProps {
  /** The verification whose report is shown (`CheckResult`, `DotnetTest`), or null when closed. */
  verificationName: string | null;
  onClose: () => void;
  /** The report, once read. */
  report?: VerificationReportData | null;
  /** The read is still out. */
  loading?: boolean;
  /** Why the read failed. */
  error?: string | null;
  /** The status the badge shows while the report is loading, or when its frontmatter has none. */
  initialStatus?: VerificationReportStatus;
  /** Passed to the report's markdown renderer. */
  wireframeBaseUrl?: string;
}

/**
 * V1's `Apps/Views/Sheets/VerificationReportSheet.cs`: the markdown of
 * `<planFolder>/Verification/<name>.md` in a right-hand sheet, titled with the verification's name,
 * its outcome badged beside the title and the report's date in the header.
 *
 * Presentational: the host reads the report and passes the read's state in. The app's connected
 * wrapper is `views/sheets/VerificationReportSheet.tsx`, which keeps the bridge fetch.
 */
export const VerificationReportSheet: React.FC<VerificationReportSheetProps> = ({
  verificationName,
  onClose,
  report,
  loading = false,
  error,
  initialStatus,
  wireframeBaseUrl,
}) => {
  const { t } = useTranslation("uiReview");
  const outcome = report?.result ?? initialStatus;

  return (
    <SheetPanel
      open={verificationName !== null}
      onClose={onClose}
      data-testid="verification-report-sheet"
      title={verificationName ?? t("verificationReport.title")}
      description={
        verificationName === null
          ? t("verificationReport.descriptionFallback")
          : t("verificationReport.description", { name: verificationName })
      }
      hideDescription
      titleAccessory={
        outcome && (
          <Badge
            variant={STATUS_VARIANT[outcome] ?? "outline"}
            data-testid="verification-sheet-status"
          >
            {statusLabel(t, outcome)}
          </Badge>
        )
      }
      actions={
        report?.date && (
          <span className="font-mono text-xs text-muted-foreground">{report.date}</span>
        )
      }
    >
      {loading && (
        <div
          className="flex h-32 items-center justify-center text-sm text-muted-foreground"
          data-testid="verification-sheet-loading"
        >
          {t("verificationReport.loading")}
        </div>
      )}

      {error && !loading && (
        <div className="space-y-2" data-testid="verification-sheet-error">
          <Callout.Error>{error}</Callout.Error>
          <p className="text-xs text-muted-foreground">
            {t("verificationReport.notFound", { name: verificationName ?? "" })}
          </p>
        </div>
      )}

      {!loading && !error && report && (
        <div data-testid="verification-sheet-content">
          <PlanMarkdown
            id={`verification-report-${verificationName}`}
            content={typeof report.content === "string" ? report.content : ""}
            article
            dangerouslyAllowLocalFiles
            wireframeBaseUrl={wireframeBaseUrl}
          />
        </div>
      )}

      {!loading && !error && !report && verificationName && (
        <p className="text-sm text-muted-foreground" data-testid="verification-sheet-empty">
          {t("verificationReport.empty", { name: verificationName })}
        </p>
      )}
    </SheetPanel>
  );
};
