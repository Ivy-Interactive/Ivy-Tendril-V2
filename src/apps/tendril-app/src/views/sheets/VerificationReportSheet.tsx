import React, { useEffect, useState } from "react";
import { VerificationReportSheet as VerificationReportSheetView } from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import type { VerificationReport, VerificationStatus } from "../../types/api";
import { describeBridgeError } from "../../types/api";

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
 * The connected half of V1's `VerificationReportSheet` (`Apps/Views/Sheets/VerificationReportSheet.cs`):
 * reads `<planFolder>/Verification/<name>.md` over the bridge and hands the read's state to the
 * library sheet, which owns everything visible.
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

  return (
    <VerificationReportSheetView
      verificationName={verificationName}
      onClose={onClose}
      report={report}
      loading={loading}
      error={error}
      initialStatus={initialStatus}
      wireframeBaseUrl={wireframeBaseUrl}
    />
  );
};
