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

/** The rows V1 probes in this step: the machine tools, minus the per-agent CLIs. */
export function machinePrerequisites(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter(
    (check) => check.category === "Prerequisite" && !AGENT_CHECK_NAMES.has(check.name),
  );
}

export interface CodingAgentStepProps {
  checks: DoctorCheck[];
  checksLoading: boolean;
  checksError: string | null;
  onRecheck: () => void;
  selectedAgent: string | null;
  /** Picking an agent advances the wizard, as in V1 - see the note below. */
  onSelectAgent: (agent: string) => void;
}

/**
 * V1's `CodingAgentStepView.BuildPicker`: a question, one line of explanation, and a
 * three-column grid of cards carrying a logo and a label. Picking a card is the whole
 * interaction - V1 has no Next button on this step, because the click *is* the advance (it runs
 * the checks for that agent and moves the stepper on when they pass), so the wizard treats a
 * click the same way and gates it on the same prerequisites.
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
              onClick={() => onSelectAgent(agent.id)}
              data-testid={`onboarding-agent-${agent.id}`}
              className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
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
