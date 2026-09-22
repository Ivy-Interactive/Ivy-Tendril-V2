import React, { useEffect, useState } from "react";
import {
  Badge,
  HeaderLayout,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ivy-interactive/components/ui";
import { PlanMarkdown } from "@ivy-interactive/components/tendril";
import { bridge } from "../api/bridge";
import type { VerificationReport, VerificationStatus } from "../types/api";
import { describeBridgeError } from "../types/api";
import { VERIFICATION_BADGE_VARIANT } from "../utils/verificationStatus";
import { ErrorBanner } from "./ErrorBanner";

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
 */
export const VerificationReportSheet: React.FC<VerificationReportSheetProps> = ({
  planId,
  verificationName,
  initialStatus,
  onClose,
  wireframeBaseUrl,
}) => {
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
    <Sheet
      open={verificationName !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        data-testid="verification-report-sheet"
        className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
      >
        <HeaderLayout
          className="min-h-0 flex-1"
          showDivider={true}
          scrollContent={false}
          contentClassName="flex h-full min-h-0 flex-col"
          header={
            <SheetHeader className="flex flex-row items-center justify-between border-b border-border py-4 pl-6 pr-8">
              <div className="flex items-center gap-3">
                <SheetTitle className="text-lg font-semibold">
                  {verificationName ?? "Verification Report"}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Verification report details for {verificationName ?? "plan"}
                </SheetDescription>
                {outcome && (
                  <Badge
                    variant={VERIFICATION_BADGE_VARIANT[outcome]}
                    data-testid="verification-sheet-status"
                  >
                    {outcome}
                  </Badge>
                )}
              </div>
              {report?.date && (
                <span className="mr-4 font-mono text-xs text-muted-foreground">{report.date}</span>
              )}
            </SheetHeader>
          }
        >
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loading && (
              <div
                className="flex h-32 items-center justify-center text-sm text-muted-foreground"
                data-testid="verification-sheet-loading"
              >
                Loading verification report…
              </div>
            )}

            {error && !loading && (
              <div className="space-y-2" data-testid="verification-sheet-error">
                <ErrorBanner>{error}</ErrorBanner>
                <p className="text-xs text-muted-foreground">
                  No verification report file found for &quot;{verificationName}&quot;.
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
                No report available for {verificationName}.
              </p>
            )}
          </div>
        </HeaderLayout>
      </SheetContent>
    </Sheet>
  );
};
