import { Terminal } from "lucide-react";
import type { DoctorCheck } from "../../types/api";
import { CheckBadge, PrerequisiteChecks } from "./PrerequisitesStep";

/**
 * The agents the wizard offers, in V1's order and with V1's labels
 * (`CodingAgentStepView.Agents`: claude, copilot, codex, gemini, antigravity, opencode).
 * `checkName` is the label the health registry reports for the same CLI, which is how a card is
 * annotated with its install status.
 */
export const ONBOARDING_AGENTS: { id: string; label: string; checkName: string }[] = [
  { id: "claude", label: "Claude", checkName: "Claude" },
  { id: "copilot", label: "Copilot", checkName: "Copilot" },
  { id: "codex", label: "Codex", checkName: "Codex" },
  { id: "gemini", label: "Gemini", checkName: "Gemini" },
  { id: "antigravity", label: "Antigravity", checkName: "Antigravity" },
  { id: "opencode", label: "OpenCode", checkName: "OpenCode" },
];

/** Registry rows that belong to an agent card rather than to the prerequisite list below it. */
const AGENT_CHECK_NAMES = new Set(ONBOARDING_AGENTS.map((agent) => agent.checkName));

/**
 * `Environment` rows the wizard still shows, because they describe a tool the operator has to fix
 * on this machine rather than a diagnostic about this installation. `gh` present but logged out
 * fails every PR flow exactly as a missing `gh` does (`health.rs::github_cli_checks`), and V1's
 * onboarding surfaced an unauthenticated tool the same way it surfaced a missing one, so hiding it
 * is the one case where "Environment" is the wrong reading of the category.
 */
const EXTRA_MACHINE_CHECK_NAMES = new Set(["GitHub CLI auth"]);

/**
 * The rows V1 probes in this step: the machine tools, minus the per-agent CLIs, plus the GitHub
 * CLI's auth state. None of them can block — `required` is `false` on all of them — which matches
 * V1, whose onboarding blocks on Git and never on `gh`.
 */
export function machinePrerequisites(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter(
    (check) =>
      (check.category === "Prerequisite" && !AGENT_CHECK_NAMES.has(check.name)) ||
      EXTRA_MACHINE_CHECK_NAMES.has(check.name),
  );
}

/**
 * The registry row for one agent's CLI, which V1 treats as a *required* check for the agent being
 * picked (`CodingAgentStepView.BuildAgentCheck` passes `required: true` regardless of anything
 * else) even though `health.rs::agent_checks` marks every agent optional: only the selected one
 * matters, and the selected one has to be there.
 */
export function agentCheck(checks: DoctorCheck[], agentId: string): DoctorCheck | undefined {
  const agent = ONBOARDING_AGENTS.find((a) => a.id === agentId);
  if (!agent) return undefined;
  return checks.find((check) => check.name === agent.checkName);
}

export function agentLabel(agentId: string): string {
  return ONBOARDING_AGENTS.find((a) => a.id === agentId)?.label ?? agentId;
}

export interface CodingAgentStepProps {
  checks: DoctorCheck[];
  checksLoading: boolean;
  checksError: string | null;
  onRecheck: () => void;
  selectedAgent: string | null;
  /** Picking an agent advances the wizard, as in V1 - see the note below. */
  onSelectAgent: (agent: string) => void;
  /** True while the pick's probe is in flight; V1 replaces the picker with a progress bar. */
  busy?: boolean;
}

/**
 * V1's `CodingAgentStepView.BuildPicker`: a question, one line of explanation, and a
 * three-column grid of cards carrying a logo and a label. Picking a card is the whole
 * interaction - V1 has no Next button on this step, because the click *is* the advance (it runs
 * the checks for that agent and moves the stepper on when they pass), so the wizard treats a
 * click the same way and gates it on the same prerequisites. The probe is re-run *on the click*,
 * not read from what the last render happened to fetch, because `RunFlowAsync` re-probes every
 * time: installing the CLI and clicking again has to work without pressing Re-check first.
 *
 * Picking an agent only records it in wizard state. Nothing reaches `config.yaml` until Finish,
 * so leaving the wizard early keeps the existing `codingAgent` exactly as it was.
 */
export function CodingAgentStep({
  checks,
  checksLoading,
  checksError,
  onRecheck,
  selectedAgent,
  onSelectAgent,
  busy = false,
}: CodingAgentStepProps) {
  const statusFor = (checkName: string) => checks.find((c) => c.name === checkName);

  return (
    <div className="space-y-4" data-testid="onboarding-step-agent">
      <h3 className="text-base font-semibold text-foreground">What is your coding agent?</h3>
      <p className="text-sm text-muted-foreground">
        Tendril is a coding orchestrator that runs on top of your own coding agent. Pick the agent
        you'd like to use:
      </p>

      <div className="grid grid-cols-3 gap-3">
        {ONBOARDING_AGENTS.map((agent) => {
          const check = statusFor(agent.checkName);
          const selected = selectedAgent === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              aria-pressed={selected}
              disabled={busy}
              onClick={() => onSelectAgent(agent.id)}
              data-testid={`onboarding-agent-${agent.id}`}
              className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-muted/50"
              }`}
            >
              <div className="flex w-full items-center gap-2">
                <Terminal className="size-8 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {agent.label}
                </span>
              </div>
              {/* Silent when the CLI is there, loud when it is not - V1's `InstallMissingDialog`
                  only ever appears for a check that failed. */}
              {check && check.status !== "Ok" && (
                <div className="flex w-full items-start gap-2">
                  <CheckBadge status={check.status} />
                  <span className="min-w-0 flex-1 break-words text-[11px] text-muted-foreground">
                    {check.message}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <PrerequisiteChecks
        checks={machinePrerequisites(checks)}
        loading={checksLoading}
        error={checksError}
        onRecheck={onRecheck}
      />
    </div>
  );
}
