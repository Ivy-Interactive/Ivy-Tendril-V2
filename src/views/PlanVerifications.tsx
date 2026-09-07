import React, { useEffect, useState } from "react";
import { bridge } from "../api/bridge";
import {
  describeBridgeError,
  type PlanVerification,
  type VerificationReport,
  type VerificationStatus,
} from "../types/api";

interface PlanVerificationsProps {
  planId: string;
  verifications: PlanVerification[];
  onVerificationChange?: (name: string, status: VerificationStatus) => void;
}

const STATUS_CLASS: Record<VerificationStatus, string> = {
  Pass: "bg-emerald-950 text-emerald-300 border-emerald-800",
  Fail: "bg-red-950 text-red-300 border-red-800",
  Skipped: "bg-slate-800 text-slate-400 border-slate-700",
  Pending: "bg-slate-800 text-slate-300 border-slate-700",
};

/**
 * Verifications tab: each verification's status plus, expandable inline, the
 * report ExecutePlan wrote to `<planFolder>/Verification/<name>.md`.
 * Operators can also toggle verification statuses with optimistic feedback.
 */
export const PlanVerifications: React.FC<PlanVerificationsProps> = ({
  planId,
  verifications,
  onVerificationChange,
}) => {
  const [localVerifications, setLocalVerifications] = useState<PlanVerification[]>(verifications);
  const [reports, setReports] = useState<Record<string, VerificationReport>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <p data-testid="no-verifications" className="text-sm text-slate-400">
        This plan has no verifications configured.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="plan-verifications">
      {error && (
        <div
          role="alert"
          data-testid="verification-reports-error"
          className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
        >
          {error}
        </div>
      )}

      {localVerifications.map((v) => {
        const report = reports[v.name];
        const isOpen = expanded === v.name;

        return (
          <div key={v.name} className="rounded-lg border border-slate-800 bg-slate-950">
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-200">{v.name}</span>
                <select
                  aria-label={`Status for ${v.name}`}
                  data-testid={`verification-status-select-${v.name}`}
                  value={v.status}
                  onChange={(e) => handleStatusChange(v.name, e.target.value as VerificationStatus)}
                  className={`rounded border px-2 py-0.5 text-xs font-medium cursor-pointer ${
                    STATUS_CLASS[v.status] ?? STATUS_CLASS.Pending
                  }`}
                >
                  <option value="Pending" className="bg-slate-900 text-slate-300">
                    Pending
                  </option>
                  <option value="Pass" className="bg-slate-900 text-emerald-300">
                    Pass
                  </option>
                  <option value="Fail" className="bg-slate-900 text-red-300">
                    Fail
                  </option>
                  <option value="Skipped" className="bg-slate-900 text-slate-400">
                    Skipped
                  </option>
                </select>
                {report?.date && <span className="text-xs text-slate-500">{report.date}</span>}
              </div>

              {report ? (
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : v.name)}
                  aria-expanded={isOpen}
                  className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700"
                >
                  {isOpen ? "Hide report" : "View report"}
                </button>
              ) : (
                <span className="text-xs text-slate-500">No report yet</span>
              )}
            </div>

            {isOpen && report && (
              <pre
                data-testid={`verification-report-${v.name}`}
                className="max-h-96 overflow-auto border-t border-slate-800 p-3 text-xs whitespace-pre-wrap text-slate-300"
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
