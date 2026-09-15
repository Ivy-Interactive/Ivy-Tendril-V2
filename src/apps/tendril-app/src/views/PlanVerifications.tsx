import React, { useEffect, useState } from "react";
import { bridge } from "../api/bridge";
import {
  describeBridgeError,
  type PlanLifecycleState,
  type PlanVerification,
  type VerificationReport,
  type VerificationStatus,
} from "../types/api";

interface PlanVerificationsProps {
  planId: string;
  verifications: PlanVerification[];
  /** The plan's lifecycle state. Only a Draft's verifications are editable. */
  planState?: PlanLifecycleState;
  onVerificationChange?: (name: string, status: VerificationStatus) => void;
}

/**
 * Badge classes for the two terminal outcomes, from `Constants.VerificationStatusBadgeVariants`
 * (V1 `src/Ivy.Tendril/Constants.cs`): Pass is Success and Fail is Destructive. Pending and
 * Skipped are Outline there and carry no badge here at all - see below.
 */
const TERMINAL_STATUS_CLASS: Record<"Pass" | "Fail", string> = {
  Pass: "border-success/40 bg-success/10 text-success",
  Fail: "border-destructive/40 bg-destructive/10 text-destructive",
};

/**
 * Verifications, as V1's `VerificationsPanelView` presents them: one checkbox per
 * verification, checked meaning "run this one". Toggling it persists Pending (checked) or
 * Skipped (unchecked) immediately.
 *
 * Editing is only allowed while the plan is in Draft. Once it has run, the checkboxes are
 * disabled and the row shows the outcome the runner recorded — Pass and Fail are facts about
 * an execution, so nothing in the UI may declare one.
 *
 * The expandable report (`<planFolder>/Verification/<name>.md`) is V2's own addition; V1 opens
 * it in a separate `VerificationReportSheet`, which this page has no room for.
 */
export const PlanVerifications: React.FC<PlanVerificationsProps> = ({
  planId,
  verifications,
  planState,
  onVerificationChange,
}) => {
  const [localVerifications, setLocalVerifications] = useState<PlanVerification[]>(verifications);
  const [reports, setReports] = useState<Record<string, VerificationReport>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `var editable = selectedPlan.Status == PlanStatus.Draft;` — with no state given, treat the
  // plan as not editable rather than inventing permission the caller never granted.
  const editable = planState === "Draft";

  useEffect(() => {
    setLocalVerifications(verifications);
  }, [verifications]);

  const verificationCount = localVerifications.length;

  useEffect(() => {
    // Nothing to fetch reports for, and asking would mean a pointless round
    // trip through the service for every plan with no verifications.
    if (verificationCount === 0) return;

    let cancelled = false;
    setError(null);

    bridge
      .listVerificationReports(planId)
      .then((list) => {
        if (cancelled) return;
        setReports(Object.fromEntries(list.map((r) => [r.name, r])));
      })
      .catch((err) => {
        if (cancelled) return;
        setReports({});
        setError(describeBridgeError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [planId, verificationCount]);

  const handleStatusChange = async (name: string, newStatus: VerificationStatus) => {
    const previous = localVerifications;
    setLocalVerifications((prev) =>
      prev.map((v) => (v.name === name ? { ...v, status: newStatus } : v)),
    );
    setError(null);

    try {
      await bridge.setVerificationStatus(planId, name, newStatus);
      onVerificationChange?.(name, newStatus);
    } catch (err) {
      setLocalVerifications(previous);
      setError(`Failed to update verification ${name}: ${describeBridgeError(err)}`);
    }
  };

  if (verificationCount === 0) {
    return (
      <p data-testid="no-verifications" className="text-sm text-muted-foreground">
        No verifications
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="plan-verifications">
      {error && (
        <div
          role="alert"
          data-testid="verification-reports-error"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {localVerifications.map((v) => {
        const report = reports[v.name];
        const isOpen = expanded === v.name;
        // A checked box means Pending while the plan is a draft; once it has run the row
        // reports the persisted status instead.
        const checked = v.status !== "Skipped";
        const terminal = v.status === "Pass" || v.status === "Fail" ? v.status : null;

        return (
          <div key={v.name} className="rounded-lg border border-border bg-background">
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    data-testid={`verification-checkbox-${v.name}`}
                    checked={checked}
                    disabled={!editable}
                    onChange={(e) =>
                      void handleStatusChange(v.name, e.target.checked ? "Pending" : "Skipped")
                    }
                    className="h-4 w-4 accent-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <span className={editable ? undefined : "text-muted-foreground"}>{v.name}</span>
                </label>
                {/* Only terminal outcomes get a badge; Pending and Skipped are conveyed by the box. */}
                {terminal && (
                  <span
                    data-testid={`verification-status-${v.name}`}
                    className={`rounded border px-2 py-0.5 text-xs font-medium ${TERMINAL_STATUS_CLASS[terminal]}`}
                  >
                    {terminal}
                  </span>
                )}
                {report?.date && (
                  <span className="text-xs text-muted-foreground/70">{report.date}</span>
                )}
              </div>

              {report ? (
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : v.name)}
                  aria-expanded={isOpen}
                  className="rounded bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  {isOpen ? "Hide report" : "View report"}
                </button>
              ) : (
                <span className="text-xs text-muted-foreground/70">No report yet</span>
              )}
            </div>

            {isOpen && report && (
              <pre
                data-testid={`verification-report-${v.name}`}
                className="max-h-96 overflow-auto border-t border-border p-3 text-xs whitespace-pre-wrap text-muted-foreground"
              >
                {report.content}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
};
