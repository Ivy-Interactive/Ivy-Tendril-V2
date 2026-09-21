import type { DoctorCheck, DoctorCheckStatus } from "../../types/api";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge, Button } from "@ivy-interactive/components/ui";
import { ErrorBanner } from "../../components/ErrorBanner";

/**
 * This module owns two things V1 keeps in two different places:
 *
 * - {@link DataStorageStep}, which is V1's `TendrilHomeStepView` (the wizard's second step,
 *   "Data Storage").
 * - The prerequisite check rows, which V1 runs *inside* its coding-agent step
 *   (`CodingAgentStepView.RunFlowAsync` + `InstallMissingDialog`), so {@link CodingAgentStep}
 *   renders {@link PrerequisiteChecks} rather than the wizard giving them a step of their own.
 */

/**
 * Tailwind classes per check status.
 *
 * V1 never paints a passing check. `CodingAgentStepView.RunFlowAsync` shows "Checking Git..."
 * while a probe runs, says nothing at all when it succeeds, and only speaks up - through
 * `InstallMissingDialog` - when something is missing. `Ok` is therefore deliberately neutral
 * here: a green pass badge would invent an emphasis V1 does not have, and with `--primary` now
 * Ivy green it would also read as the wizard's primary action colour. Warn and Fail carry the
 * semantic warning/destructive tokens.
 */
export const CHECK_STATUS_CLASSES: Record<DoctorCheckStatus, string> = {
  Ok: "border-border bg-muted text-muted-foreground",
  Warn: "border-warning/40 bg-warning/10 text-warning",
  Fail: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** The bracketed tag doctor prints; mirrors `CheckStatus::tag()` in `tendril-core`. */
const STATUS_LABELS: Record<DoctorCheckStatus, string> = {
  Ok: "OK",
  Warn: "WARN",
  Fail: "FAIL",
};

export function CheckBadge({ status }: { status: DoctorCheckStatus }) {
  return (
    <Badge
      variant="outline"
      className={`px-1.5 py-0.5 text-2xs font-bold uppercase ${CHECK_STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * The checks that stop the wizard, matching V1's gate: `CodingAgentStepView` will not advance the
 * stepper while a required `SoftwareCheck` fails - it reopens `InstallMissingDialog` instead. The
 * registry's own `required` flag decides, per its contract in `tendril-core::health`: "`false`
 * means Tendril still works without it - the wizard must not block on those."
 */
export function blockingChecks(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter((check) => check.required && check.status === "Fail");
}

export interface PrerequisiteChecksProps {
  /** Already narrowed by the caller to the rows that step is responsible for. */
  checks: DoctorCheck[];
  loading: boolean;
  error: string | null;
  onRecheck: () => void;
}

/**
 * The machine prerequisites, from the one registry in `tendril-core` that `tendril doctor` also
 * prints. V1 probes these one at a time behind a progress bar and blocks on a missing required
 * tool with a dialog whose two buttons are Install ("open the install page") and OK ("once you've
 * installed it"); the list form keeps both affordances - Install per row, Re-check for the whole
 * set - because V2's registry reports every probe in one call instead of sequentially.
 */
export function PrerequisiteChecks({ checks, loading, error, onRecheck }: PrerequisiteChecksProps) {
  const openInstall = (url: string) => {
    void openUrl(url).catch(() => {});
  };

  const blocking = blockingChecks(checks);

  return (
    <div className="space-y-3" data-testid="onboarding-prerequisites">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {blocking.length > 0
            ? `Tendril needs ${blocking.map((check) => check.name).join(", ")} but it isn't installed. Install it, then press Re-check.`
            : "The tools Tendril launches on your machine."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRecheck}
          disabled={loading}
          data-testid="onboarding-recheck"
          className="shrink-0 text-xs"
        >
          {loading ? "Checking…" : "Re-check"}
        </Button>
      </div>

      {error && <ErrorBanner data-testid="onboarding-checks-error">{error}</ErrorBanner>}

      {!error && checks.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">No checks reported.</p>
      )}

      {checks.length > 0 && (
        <ul className="divide-y divide-border rounded-box border border-border">
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
                    <span className="ml-2 text-2xs uppercase text-muted-foreground">required</span>
                  )}
                </div>
                <div className="break-words text-xs text-muted-foreground">{check.message}</div>
              </div>
              {check.status !== "Ok" && check.installUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openInstall(check.installUrl as string)}
                  data-testid={`onboarding-install-${check.name}`}
                  className="shrink-0 text-xs"
                >
                  Install
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface DataStorageStepProps {
  /** Where this install keeps its config, plans and database. */
  tendrilHome: string;
}

/**
 * V1's `TendrilHomeStepView`: one question, one field, and Next gated on the path being non-empty
 * (the wizard owns that gate, exactly as V1's `.Disabled(...)` does).
 *
 * The field is read-only here, which is the one deliberate difference: V1 can bootstrap a new home
 * because the app *is* the process that reads it, while V2's daemon resolves `TENDRIL_HOME` at
 * startup and `PUT /api/config` writes keys *inside* config.yaml, not the directory that holds it.
 */
export function DataStorageStep({ tendrilHome }: DataStorageStepProps) {
  return (
    <div className="space-y-4" data-testid="onboarding-step-data-storage">
      <h3 className="text-base font-semibold text-foreground">Where should we store your data?</h3>
      <p className="text-sm text-muted-foreground">
        Tendril keeps your config and plans in this folder.
      </p>

      <div className="space-y-1">
        <label
          className="block text-xs font-medium text-foreground"
          htmlFor="onboarding-tendril-home-input"
        >
          Tendril Home <span className="text-destructive">*</span>
        </label>
        <input
          id="onboarding-tendril-home-input"
          type="text"
          readOnly
          value={tendrilHome}
          data-testid="onboarding-tendril-home"
          className="w-full rounded-field border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground"
        />
        {tendrilHome ? (
          <p className="text-xs text-muted-foreground">
            The running daemon resolved this folder. Set{" "}
            <code className="font-mono">TENDRIL_HOME</code> before starting Tendril to move it.
          </p>
        ) : (
          <p className="text-xs text-destructive" data-testid="onboarding-tendril-home-error">
            Please provide a valid path.
          </p>
        )}
      </div>
    </div>
  );
}
