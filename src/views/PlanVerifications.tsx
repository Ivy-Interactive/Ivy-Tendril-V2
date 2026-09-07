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
}

const STATUS_CLASS: Record<VerificationStatus, string> = {
  Pass: "bg-emerald-950 text-emerald-300 border-emerald-800",
  Fail: "bg-red-950 text-red-300 border-red-800",
  Skipped: "bg-slate-800 text-slate-400 border-slate-700",
  Pending: "bg-slate-800 text-slate-300 border-slate-700",
};

/**
 * Verifications tab: each verification's status plus, expandable inline, the
 * report ExecutePlan wrote to `<planFolder>/Verification/<name>.md`. Previously
 * this tab showed status alone, so a failing verification gave the operator no
 * way to see *why* it failed without leaving the app.
 */
export const PlanVerifications: React.FC<PlanVerificationsProps> = ({
  planId,
  verifications,
}) => {
  const [reports, setReports] = useState<Record<string, VerificationReport>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [planId]);

  if (verifications.length === 0) {
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
          data-testid="verification-reports-error"
          className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
        >
          {error}
        </div>
      )}

      {verifications.map((v) => {
        const report = reports[v.name];
        const isOpen = expanded === v.name;

        return (
          <div
            key={v.name}
            className="rounded-lg border border-slate-800 bg-slate-950"
          >
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-200">
                  {v.name}
                </span>
                <span
                  className={`rounded border px-2 py-0.5 text-xs font-medium ${
                    STATUS_CLASS[v.status] ?? STATUS_CLASS.Pending
                  }`}
                >
                  {v.status}
                </span>
                {report?.date && (
                  <span className="text-xs text-slate-500">{report.date}</span>
                )}
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
