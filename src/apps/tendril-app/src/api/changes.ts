import type { ChangeEvent } from "./events";

/**
 * The client caches a change event may invalidate. Passed in rather than imported so the policy
 * below is testable without rendering the shell.
 */
export interface ChangeInvalidationDeps {
  refreshPlans: () => void;
  refreshPlanDetail: (folder: string) => void;
  refreshJobs: () => void;
  refreshProjects: () => void;
  /**
   * Re-reads the `chatMode` setting. Optional so a caller that does not launch chats (a test, an
   * embedded host) need not supply one.
   */
  refreshChatMode?: () => void;
  /** Re-reads the `language` setting and applies it. Optional for the same reason. */
  refreshLanguage?: () => void;
  /** Folder path or name of the plan currently open in the detail view, if any. */
  selectedPlanFolder?: string | null;
}

/** Applies one change event to the client caches. */
export function applyChangeEvent(event: ChangeEvent, deps: ChangeInvalidationDeps): void {
  const target = event.target;

  switch (target.kind) {
    case "plans": {
      deps.refreshPlans();
      // Job-driven Dashboard counts (retry loop, PR label) go stale otherwise: job events only
      // append stream output, they never refresh the list. Same reasoning as the onPlanEvent
      // handler in App.tsx.
      deps.refreshJobs();

      if (
        deps.selectedPlanFolder &&
        shouldRefreshDetailFor(target.folder, deps.selectedPlanFolder)
      ) {
        deps.refreshPlanDetail(target.folder ?? deps.selectedPlanFolder);
      }
      break;
    }
    case "config": {
      // The shell's `projects` state and every project dropdown are derived from config.yaml.
      deps.refreshProjects();
      // So is `chatMode`, and it used to be the one derived value nothing refreshed: the shell read
      // it once at mount, so choosing "terminal" in Appearance did nothing until the app restarted.
      // The setting is written through the same `putConfig` that raises this event, so the pane that
      // changed it and a `tendril config` edit from the CLI both land here.
      deps.refreshChatMode?.();
      // And the UI language, so a `tendril config set language de` or an edit in the raw config editor
      // switches the running app rather than waiting for a restart.
      deps.refreshLanguage?.();
      break;
    }
    case "inbox": {
      // Deliberately nothing. V2's InboxView is the GitHub-issues inbox; file-based
      // <TendrilHome>/Inbox/*.md ingestion does not exist yet. The event is carried end-to-end so
      // that consumer is a one-liner when ingestion lands.
      break;
    }
  }
}

/**
 * Port of `PlanRefreshGate.ShouldRefreshFor`: rebuilding a single-plan view is expensive, so only do
 * it when the change names that plan (or is a full rescan).
 *
 * Compares last path segments, since one side is a folder path and the other a folder name. A `null`
 * changed folder is a full rescan and always matches; no selection also returns `true`, leaving the
 * caller to decide whether there is anything to refresh.
 */
export function shouldRefreshDetailFor(
  changedFolder: string | null,
  selectedFolder?: string | null,
): boolean {
  if (changedFolder === null || changedFolder === undefined) {
    return true;
  }
  if (!selectedFolder) {
    return true;
  }
  return lastSegment(changedFolder) === lastSegment(selectedFolder);
}

/** Lowercased final path segment, tolerating either separator and a trailing one. */
function lastSegment(value: string): string {
  const parts = value.replace(/[/\\]+$/, "").split(/[/\\]/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}
