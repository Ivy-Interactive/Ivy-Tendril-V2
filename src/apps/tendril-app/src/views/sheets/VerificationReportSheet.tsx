import React, { useEffect, useState } from "react";
import { Badge, SheetPanel } from "@ivy-interactive/components/ui";
import { PlanMarkdown } from "@ivy-interactive/components/tendril";
import { bridge } from "../../api/bridge";
import type { VerificationReport, VerificationStatus } from "../../types/api";
import { describeBridgeError } from "../../types/api";
import { VERIFICATION_BADGE_VARIANT } from "../../utils/verificationStatus";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useTranslation } from "../../i18n";
import { verificationStatusLabel } from "../PlanVerifications";

export interface VerificationReportSheetProps {
  /** The plan id whose verification report is being inspected. */
  planId: string | null | undefined;
  /** The verification name (e.g. "CheckResult", "DotnetTest"), or null if closed. */
  verificationName: string | null;
  /** Initial status for the badge while the report is loading or if frontmatter has no result. */
  initialStatus?: VerificationStatus;
  onClose: () => void;
  wireframeBaseUrl?: string;
}

/**
 * V1's `VerificationReportSheet` (`Apps/Views/Sheets/VerificationReportSheet.cs`):
 * opens a right-side sheet with the markdown content of `<planFolder>/Verification/<name>.md`.
 *
 * The chrome is the shared `SheetPanel`, at `UxHelper.SheetWidth` like every ported sheet. It used
 * to be spelled out here, with a `border-b` of its own under `HeaderLayout`'s divider — a double
 * rule under the title.
 */
export const VerificationReportSheet: React.FC<VerificationReportSheetProps> = ({
  planId,
  verificationName,
  initialStatus,
  onClose,
  wireframeBaseUrl,
}) => {
  const { t } = useTranslation("plans");
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId || !verificationName) {
      setReport(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);

    bridge
      .getVerificationReport(planId, verificationName)
      .then((res) => {
        if (!cancelled) {
          setReport(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(describeBridgeError(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [planId, verificationName]);

  const outcome = report?.result ?? initialStatus;

  return (
    <SheetPanel
      open={verificationName !== null}
      onClose={onClose}
      data-testid="verification-report-sheet"
      title={verificationName ?? t("reportSheet.title")}
      description={
        verificationName === null
          ? t("reportSheet.descriptionFallback")
          : t("reportSheet.description", { name: verificationName })
      }
      hideDescription
      titleAccessory={
        outcome && (
          <Badge
            variant={VERIFICATION_BADGE_VARIANT[outcome]}
            data-testid="verification-sheet-status"
          >
            {verificationStatusLabel(t, outcome)}
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
          {t("reportSheet.loading")}
        </div>
      )}

      {error && !loading && (
        <div className="space-y-2" data-testid="verification-sheet-error">
          <ErrorBanner>{error}</ErrorBanner>
          <p className="text-xs text-muted-foreground">
            {t("reportSheet.notFound", { name: verificationName })}
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
          {t("reportSheet.empty", { name: verificationName })}
        </p>
      )}
    </SheetPanel>
  );
};
