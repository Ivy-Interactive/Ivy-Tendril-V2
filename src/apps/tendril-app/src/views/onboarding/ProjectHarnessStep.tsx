import React from "react";
import { bridge } from "../../api/bridge";
import { describeBridgeError, type ProjectSummary } from "../../types/api";

/**
 * V1's `ProjectCrudStepView`, the project section's third sub-step: what the setup run configured,
 * read back off the project row.
 *
 * V1's is an editor - per-verification Edit/Delete dialogs, a review-action table, Add buttons for
 * both. This lists rather than edits, for the reason `AddProjectView`'s harness step gives: every
 * one of these has a full editor on the project's own settings screen, and a second one built into a
 * wizard the operator sees once would be two places to fix one bug.
 *
 * The re-read on `refreshToken` is V1's `config.ReloadSettings()` plus the refresh-token bump its
 * completion handler does - the agent writes through the `tendril` CLI, so this is reading a file
 * that changed under the app.
 */

export interface ProjectHarnessStepProps {
  projectName: string;
  /** Changes when the setup run ends, which is what makes this re-read what the agent wrote. */
  refreshToken: number;
}

export function ProjectHarnessStep({ projectName, refreshToken }: ProjectHarnessStepProps) {
  const [project, setProject] = React.useState<ProjectSummary | null>(null);
  // Kept apart from `project === null`. Both render nothing, but they mean opposite things: a null
  // project is "the agent configured nothing yet", a load error is "we could not ask". Folding the
  // second into the first tells the operator their harness is empty when in fact it is unread, and
  // sends them to reconfigure something that may already be right.
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    bridge
      .listProjects()
      .then((list) => {
        if (cancelled) return;
        const match = list.find((p) => p.name.toLowerCase() === projectName.trim().toLowerCase());
        setProject(match ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProject(null);
        setLoadError(describeBridgeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectName, refreshToken]);

  const verifications = project?.verifications ?? [];
  const reviewActions = project?.reviewActions ?? [];

  return (
    <div className="space-y-4" data-testid="onboarding-step-harness">
      <h3 className="text-base font-semibold text-foreground">Review Harness</h3>
      <p className="text-sm text-muted-foreground">
        What the setup agent configured for your project. Everything here is editable from the
        project&apos;s own screen.
      </p>

      <div className="space-y-1">
        <span className="block text-xs font-medium text-foreground">Verifications</span>
        <p className="text-xs text-muted-foreground">
          The steps run after each plan execution to validate changes.
        </p>
        {verifications.length > 0 && (
          <ul className="space-y-1 pt-1" data-testid="onboarding-harness-verifications">
            {verifications.map((name) => (
              <li key={name} className="rounded-selector bg-muted/50 px-2 py-1.5 text-xs">
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <span className="block text-xs font-medium text-foreground">Review Actions</span>
        <p className="text-xs text-muted-foreground">
          Commands that make it easy to start your project for manual testing.
        </p>
        {reviewActions.length > 0 && (
          <ul className="space-y-1 pt-1" data-testid="onboarding-harness-review-actions">
            {reviewActions.map((action) => (
              <li key={action.name} className="rounded-selector bg-muted/50 px-2 py-1.5">
                <p className="text-xs font-medium text-foreground">{action.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{action.command}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loadError !== null && (
        <p className="text-xs text-muted-foreground" data-testid="onboarding-harness-error">
          Could not read your project&apos;s harness ({loadError}). This says nothing about what the
          setup agent configured - open the project from the Projects row to see it.
        </p>
      )}

      {loadError === null && verifications.length === 0 && reviewActions.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="onboarding-harness-empty">
          Nothing is configured yet. If the setup agent is still running, its results appear here
          once it finishes - reopen the project from the Projects row to see them.
        </p>
      )}
    </div>
  );
}
