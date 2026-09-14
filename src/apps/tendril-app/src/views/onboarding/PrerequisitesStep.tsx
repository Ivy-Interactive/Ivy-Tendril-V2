import { openUrl } from "@tauri-apps/plugin-opener";
import type { DoctorCheck, DoctorCheckStatus } from "../../types/api";

/** Tailwind classes per check status, shared with {@link CodingAgentStep}'s annotations. */
export const CHECK_STATUS_CLASSES: Record<DoctorCheckStatus, string> = {
  Ok: "border-green-500/40 bg-green-500/10 text-green-500",
  Warn: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500",
  Fail: "border-destructive/40 bg-destructive/10 text-destructive",
};

const STATUS_LABELS: Record<DoctorCheckStatus, string> = {
  Ok: "OK",
  Warn: "WARN",
  Fail: "FAIL",
};

export function CheckBadge({ status }: { status: DoctorCheckStatus }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${CHECK_STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export interface PrerequisitesStepProps {
  checks: DoctorCheck[];
  loading: boolean;
  error: string | null;
  onRecheck: () => void;
  /** Where this install keeps its config, plans and database — read-only here. */
  tendrilHome: string;
}

/**
 * The same probes `tendril doctor` prints, from the one registry in `tendril-core`.
 *
 * Nothing on this step can block Continue: an absent `gh` or a coding agent the operator does not
 * use is reported, not enforced. Only the operator decides when to move on.
 */
export function PrerequisitesStep({
  checks,
  loading,
  error,
  onRecheck,
  tendrilHome,
}: PrerequisitesStepProps) {
  const openInstall = (url: string) => {
    void openUrl(url).catch(() => {});
  };

  return (
    <div className="space-y-4" data-testid="onboarding-step-prerequisites">
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <div className="text-muted-foreground">Tendril Home</div>
        <div className="mt-0.5 font-mono text-foreground" data-testid="onboarding-tendril-home">
          {tendrilHome || "(not resolved)"}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Checking the tools Tendril launches. Warnings are informational — you can continue with
          any of them unresolved.
        </p>
        <button
          type="button"
          onClick={onRecheck}
          disabled={loading}
          data-testid="onboarding-recheck"
          className="ml-3 shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          data-testid="onboarding-checks-error"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {!error && checks.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">No checks reported.</p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {checks.map((check) => (
          <li
            key={`${check.category}-${check.name}`}
            data-testid={`onboarding-check-${check.name}`}
            className="flex items-start gap-3 p-3"
          >
            <CheckBadge status={check.status} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-foreground">
                {check.name}
                {check.required && (
                  <span className="ml-2 text-[10px] uppercase text-muted-foreground">required</span>
                )}
              </div>
              <div className="break-words text-xs text-muted-foreground">{check.message}</div>
            </div>
            {check.status !== "Ok" && check.installUrl && (
              <button
                type="button"
                onClick={() => openInstall(check.installUrl as string)}
                data-testid={`onboarding-install-${check.name}`}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
              >
                Install
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
