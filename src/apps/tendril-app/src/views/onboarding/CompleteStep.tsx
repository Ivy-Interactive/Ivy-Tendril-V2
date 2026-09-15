import { NewsletterSignup } from "../../components/NewsletterSignup";
import { ONBOARDING_AGENTS } from "./CodingAgentStep";

export interface CompleteStepProps {
  selectedAgent: string | null;
  projectName: string;
  projectRegistered: boolean;
}

/**
 * What Finish will write, spelled out. At most two keys are touched — `codingAgent` (only when an
 * agent was picked) and `onboarding` — and both are merged into `config.yaml`, never rewritten over.
 */
export function CompleteStep({ selectedAgent, projectName, projectRegistered }: CompleteStepProps) {
  const agentLabel = ONBOARDING_AGENTS.find((a) => a.id === selectedAgent)?.label;

  return (
    <div className="space-y-4" data-testid="onboarding-step-complete">
      <p className="text-sm text-muted-foreground">
        That is everything Tendril needs. Finish saves your choices and opens the app.
      </p>

      <ul className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <li>
          <span className="text-muted-foreground">Coding agent: </span>
          <span className="text-foreground" data-testid="onboarding-summary-agent">
            {agentLabel ?? "not selected — Settings keeps the current value"}
          </span>
        </li>
        <li>
          <span className="text-muted-foreground">First project: </span>
          <span className="text-foreground" data-testid="onboarding-summary-project">
            {projectRegistered && projectName ? projectName : "skipped — add one from Settings"}
          </span>
        </li>
      </ul>

      <p className="text-xs text-muted-foreground">
        Next: create a plan from the Dashboard, or let a running AddProject job finish deriving your
        project's verifications first.
      </p>

      <div className="rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">Newsletter</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Be the first to know when we have a new release!
        </p>
        <div className="mt-3">
          <NewsletterSignup />
        </div>
      </div>
    </div>
  );
}
