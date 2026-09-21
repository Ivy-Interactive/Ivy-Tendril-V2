import React from "react";
import { Spinner } from "@ivy-interactive/components/ui";

/**
 * V1's `ProjectAgentStepView`, the middle of the project section's three sub-steps: the wizard has
 * committed the project and handed the derivation work to an agent, and this is where that run is
 * watched.
 *
 * Two parts of V1's step are not reachable here and are dropped rather than faked. There is no
 * per-repo clone progress bar: the daemon does clone a remote (`tendril_core::git::clone`, reached
 * through `createProject`), but it does so inside that one call and reports only the finished repo
 * paths, so there is no per-repo progress to draw - `registerProject` says "Cloning repositories..."
 * for the whole call instead. There is no auth or device-code flow, because no daemon route probes
 * an agent's authentication (`health.rs` only shells `probe_version`).
 *
 * The install check V1 runs here happens two steps earlier, in the wizard's `pickAgent`: choosing an
 * agent runs the doctor and refuses to leave the agent step when a requirement is missing. So by the
 * time this step is on screen the check has already passed, and repeating it here would only be a
 * second chance to fail at something already settled.
 *
 * What is left is V1's body, and it is `AddProjectAgentRun` unchanged - the Add Project blade's
 * viewer, which already carries V1's "render the box before the first line so it does not swap in"
 * rationale and the failure line.
 */

/**
 * Lazy for the reason `AddProjectView` gives for the same component, and it matters more here:
 * `App.tsx` imports this wizard eagerly, so a static edge would put `AgentViewer` in the entry chunk.
 */
const AgentRunPanel = React.lazy(() =>
  import("../settings/AddProjectAgentRun").then((m) => ({ default: m.AddProjectAgentRun })),
);

export interface ProjectAgentStepProps {
  /**
   * The `AddProject` run to watch. Null when there is nothing to watch: the operator adopted an
   * existing project instead of creating one, backed out of a run, or the hand-off never started.
   */
  jobId: string | null;
  /** Fires once the run reaches a terminal status, which is what ungates the step's Next. */
  onFinished: () => void;
}

export function ProjectAgentStep({ jobId, onFinished }: ProjectAgentStepProps) {
  return (
    <div className="space-y-4" data-testid="onboarding-step-project-agent">
      <h3 className="text-base font-semibold text-foreground">Setting up your project</h3>

      {jobId === null ? (
        <p className="text-sm text-muted-foreground" data-testid="onboarding-agent-no-run">
          No setup run is attached to this project. You can configure its verifications and review
          actions from the project&apos;s own screen once setup is finished.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Tendril is detecting your tech stack and configuring your agentic harness. This will
            take a few minutes, so treat yourself to a ☕ while you wait.
          </p>
          <React.Suspense
            fallback={
              <div
                className="flex h-32 items-center justify-center text-muted-foreground"
                data-testid="onboarding-agent-loading"
              >
                <Spinner size="lg" className="text-success" aria-hidden="true" />
              </div>
            }
          >
            <AgentRunPanel jobId={jobId} onFinished={onFinished} />
          </React.Suspense>
        </>
      )}
    </div>
  );
}
