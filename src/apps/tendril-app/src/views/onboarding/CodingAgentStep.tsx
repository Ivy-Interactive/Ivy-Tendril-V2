import type { DoctorCheck } from "../../types/api";
import { CheckBadge } from "./PrerequisitesStep";

/**
 * The agents `build_agent_spec` can launch. `checkName` is the label the health registry reports for
 * the same CLI, which is how a card is annotated with its install status.
 */
export const ONBOARDING_AGENTS: { id: string; label: string; checkName: string; blurb: string }[] =
  [
    { id: "claude", label: "Claude Code", checkName: "Claude", blurb: "Anthropic's CLI agent." },
    { id: "codex", label: "Codex", checkName: "Codex", blurb: "OpenAI's CLI agent." },
    { id: "gemini", label: "Gemini", checkName: "Gemini", blurb: "Google's CLI agent." },
    { id: "copilot", label: "Copilot", checkName: "Copilot", blurb: "GitHub's CLI agent." },
    { id: "opencode", label: "OpenCode", checkName: "OpenCode", blurb: "Open-source CLI agent." },
    {
      id: "antigravity",
      label: "Antigravity",
      checkName: "Antigravity",
      blurb: "Antigravity's agy CLI.",
    },
  ];

export interface CodingAgentStepProps {
  checks: DoctorCheck[];
  selectedAgent: string | null;
  onSelectAgent: (agent: string) => void;
}

/**
 * Picking an agent only records it in wizard state. Nothing reaches `config.yaml` until Finish, so
 * skipping out of the wizard here leaves the existing `codingAgent` exactly as it was.
 */
export function CodingAgentStep({ checks, selectedAgent, onSelectAgent }: CodingAgentStepProps) {
  const statusFor = (checkName: string) => checks.find((c) => c.name === checkName);

  return (
    <div className="space-y-4" data-testid="onboarding-step-agent">
      <p className="text-sm text-muted-foreground">
        Which coding agent should run your jobs? You can change this later in Settings, and an agent
        that is not installed yet is still a valid choice.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-muted/50"
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{agent.label}</span>
                {check && <CheckBadge status={check.status} />}
              </div>
              <span className="text-xs text-muted-foreground">{agent.blurb}</span>
              {check && <span className="text-[11px] text-muted-foreground">{check.message}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
