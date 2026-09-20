import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@ivy-interactive/components/ui";
import { bridge } from "../api/bridge";
import { plansStore } from "../state/plansStore";
import {
  describeBridgeError,
  type PlanLifecycleState,
  type PlanVerification,
  type VerificationReport,
  type VerificationStatus,
} from "../types/api";
import { TERMINAL_VERIFICATION_CLASS } from "../utils/verificationStatus";
import { ErrorBanner } from "../components/ErrorBanner";

interface PlanVerificationsProps {
  planId: string;
  verifications: PlanVerification[];
  /**
   * The plan's `project` field, used to order the list the way the project runs them. Omitted, the
   * list keeps `plan.yaml` order.
   */
  project?: string;
  /** The plan's lifecycle state. Only a Draft's verifications are editable. */
  planState?: PlanLifecycleState;
  onVerificationChange?: (name: string, status: VerificationStatus) => void;
}

/**
 * Verifications in the order the project runs them, a port of
 * `PlanCommandHelpers.OrderByProjectConfig`.
 *
 * V1's comment on it: "Orders verifications by their position in the project config (the
 * authoritative run order), regardless of how they happen to be stored in plan.yaml. Verifications
 * not present in the project config (custom, or since-removed) sort to the end, keeping their
 * relative order." A plan is seeded in project order, so this only bites once the project's list has
 * been reordered afterwards — at which point the plan shows one order and the run uses another.
 *
 * The sort is stable, so unknown names (all `Number.MAX_SAFE_INTEGER`) keep the order they came in.
 * Names are matched case-insensitively, as V1's `StringComparer.OrdinalIgnoreCase` map does.
 */
export function orderByProjectConfig(
  verifications: PlanVerification[],
  projectVerifications: string[] | undefined,
): PlanVerification[] {
  if (!projectVerifications || projectVerifications.length === 0) return verifications;
  const order = new Map<string, number>();
  projectVerifications.forEach((name, index) => {
    const key = name.toLowerCase();
    if (!order.has(key)) order.set(key, index);
  });
  const rank = (v: PlanVerification) => order.get(v.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
  return verifications
    .map((v, index) => ({ v, index }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.index - b.index)
    .map((entry) => entry.v);
}

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
  project,
  planState,
  onVerificationChange,
}) => {
  const [localVerifications, setLocalVerifications] = useState<PlanVerification[]>(verifications);
  const [reports, setReports] = useState<Record<string, VerificationReport>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectVerifications, setProjectVerifications] = useState<string[] | undefined>(undefined);

  // `var editable = selectedPlan.Status == PlanStatus.Draft;` — with no state given, treat the
  // plan as not editable rather than inventing permission the caller never granted.
  const editable = planState === "Draft";

  useEffect(() => {
    setLocalVerifications(verifications);
  }, [verifications]);

  const verificationCount = localVerifications.length;

  /**
   * The project's own verification list, which is the run order.
   *
   * V1 reads it straight off the config service — `config.GetProject(selectedPlan.Project)?
   * .Verifications ?? new List<ProjectVerificationRef>()` — and its comment on the resulting order is
   * "Always present in project-config order, regardless of plan.yaml storage order." The service here
   * returns `plan.yaml` order from every HTTP read point, so the ordering has to happen client side.
   *
   * Fetched only when there is something to order, and a failure leaves it undefined, which means
   * `plan.yaml` order — the same thing V1 falls back to when the project cannot be resolved.
   */
  useEffect(() => {
    if (!project || verificationCount === 0) {
      setProjectVerifications(undefined);
      return;
    }
    let cancelled = false;
    bridge
      .listProjects()
      .then((projects) => {
        if (cancelled) return;
        // V1 looks the project up by the plan's whole `project` string, so a plan naming several
        // comma-separated projects resolves to nothing and keeps plan.yaml order. Matched
        // case-insensitively, as the daemon matches it.
        const wanted = project.trim().toLowerCase();
        const match = projects.find((p) => p.name.trim().toLowerCase() === wanted);
        setProjectVerifications(match?.verifications);
      })
      .catch(() => {
        if (!cancelled) setProjectVerifications(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [project, verificationCount]);

  const orderedVerifications = useMemo(
    () => orderByProjectConfig(localVerifications, projectVerifications),
    [localVerifications, projectVerifications],
  );

  /**
   * What the report read is keyed on.
   *
   * The count alone froze the reports for the life of the tab: a verification run writes its report
   * without changing how many there are, so "No report yet" stayed on a row whose report had just
   * landed. The statuses move whenever a run finishes, which is exactly when a report appears, and
   * they are what V1's `LoadPlanContent` recomputes the report map from on every revalidation.
   */
  const reportsKey = localVerifications.map((v) => `${v.name}:${v.status}`).join(",");

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
  }, [planId, verificationCount, reportsKey]);

  const handleStatusChange = async (name: string, newStatus: VerificationStatus) => {
    const previous = localVerifications;
    setLocalVerifications((prev) =>
      prev.map((v) => (v.name === name ? { ...v, status: newStatus } : v)),
    );
    setError(null);

    try {
      // Written through the store rather than straight to the bridge, so the plan the rest of the app
      // is rendering carries the new status too. V1 gets this for free: its panel writes through
      // `planService` and the whole view rebuilds off the refreshed `PlanFile`, which is what keeps
      // the Review page's Complete gate honest. The store also holds the rollback for its own copy;
      // the local rollback below is for this list's.
      await plansStore.updateVerificationOptimistic(planId, name, newStatus);
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
      {error && <ErrorBanner data-testid="verification-reports-error">{error}</ErrorBanner>}

      {orderedVerifications.map((v) => {
        const report = reports[v.name];
        const isOpen = expanded === v.name;
        // A checked box means Pending while the plan is a draft; once it has run the row
        // reports the persisted status instead.
        const checked = v.status !== "Skipped";
        const terminal = v.status === "Pass" || v.status === "Fail" ? v.status : null;

        return (
          <div key={v.name} className="rounded-box border border-border bg-background">
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
                    className={`rounded border px-2 py-0.5 text-xs font-medium ${TERMINAL_VERIFICATION_CLASS[terminal]}`}
                  >
                    {terminal}
                  </span>
                )}
                {report?.date && (
                  <span className="text-xs text-muted-foreground/70">{report.date}</span>
                )}
              </div>

              {report ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setExpanded(isOpen ? null : v.name)}
                  aria-expanded={isOpen}
                  className="h-auto bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {isOpen ? "Hide report" : "View report"}
                </Button>
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
