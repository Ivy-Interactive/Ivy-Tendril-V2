import * as React from "react";
import { Button, Callout, Input, Textarea } from "@ivy-interactive/components/ui";
import { PlanActionsController } from "../../controllers/planActions";
import {
  describeBridgeError,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";
import { DialogShell } from "./DialogShell";
import { SELECT_FIELD_CLASS } from "./selectField";

export interface CreateIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  /** Fallback when the plan records no repos of its own. */
  projectRepos?: string[];
  onJobStarted?: (response: StartJobResponse) => void;
}

/**
 * Opens a GitHub issue from the plan via the CreateIssue promptware.
 *
 * `repo` is the **local repository path**, not an `owner/name` slug:
 * `CreateIssueArgs.repo` is the working directory the promptware runs `gh` in.
 * That is why it is a select over the plan's repos rather than a text box.
 *
 * Assignee and labels stay free text — `GET /api/projects/:name/issues/metadata`
 * returns issue metadata, not the org's assignable users, so there is no list to
 * populate a picker from.
 */
export function CreateIssueDialog({
  isOpen,
  onClose,
  plan,
  projectRepos = [],
  onJobStarted,
}: CreateIssueDialogProps) {
  const repos = React.useMemo(() => {
    const planRepos = "repos" in plan && plan.repos ? plan.repos : [];
    return planRepos.length > 0 ? planRepos : projectRepos;
  }, [plan, projectRepos]);

  const [repo, setRepo] = React.useState(repos[0] ?? "");
  const [assignee, setAssignee] = React.useState("");
  const [labels, setLabels] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // V1 puts `.AutoFocus()` on the repository select: it is the one required field, and the only one
  // that changes what the other two mean. Safe to focus here because nothing in this dialog is
  // destructive.
  const repoRef = React.useRef<HTMLSelectElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setRepo(repos[0] ?? "");
      setAssignee("");
      setLabels("");
      setComment("");
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen, repos]);

  const handleSubmit = async () => {
    if (!repo) return;
    const labelList = labels
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");

    setIsBusy(true);
    setError(null);
    try {
      const response = await PlanActionsController.createIssue(plan, {
        repo,
        assignee: assignee.trim() || undefined,
        labels: labelList,
        comment: comment.trim() || undefined,
      });
      onJobStarted?.(response);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={`Create GitHub Issue #${plan.id}`}
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={() => void handleSubmit()}
      description="CreateIssue writes the issue body from the plan and opens it with `gh` in the selected repository."
      testId="create-issue-dialog"
      initialFocusRef={repos.length === 0 ? cancelRef : repoRef}
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={onClose}
            data-testid="dialog-cancel"
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            data-testid="dialog-confirm"
            disabled={isBusy || repo === ""}
          >
            {isBusy ? "Starting…" : "Create Issue"}
          </Button>
        </>
      }
    >
      <div>
        <label htmlFor="create-issue-repo" className="mb-1 block text-xs text-muted-foreground">
          Repository
        </label>
        {repos.length === 0 ? (
          <p className="text-sm text-warning" data-testid="create-issue-no-repos">
            Neither the plan nor its project records a repository, so there is nowhere to run{" "}
            <code>gh</code>. Add one to the plan first.
          </p>
        ) : (
          <select
            id="create-issue-repo"
            ref={repoRef}
            aria-label="Repository"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            className={SELECT_FIELD_CLASS}
          >
            {repos.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          The local repository path the issue is opened against, not an owner/name slug.
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="create-issue-assignee" className="mb-1 block text-xs text-muted-foreground">
          Assignee
        </label>
        <Input
          id="create-issue-assignee"
          aria-label="Assignee"
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
          placeholder="octocat"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="create-issue-labels" className="mb-1 block text-xs text-muted-foreground">
          Labels
        </label>
        <Input
          id="create-issue-labels"
          aria-label="Labels"
          value={labels}
          onChange={(event) => setLabels(event.target.value)}
          placeholder="bug, ui"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Comma-separated. Assignee and labels are free text: the service exposes issue metadata,
          not the org&apos;s assignable users, so there is no list to pick from.
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="create-issue-comment" className="mb-1 block text-xs text-muted-foreground">
          Comment
        </label>
        <Textarea
          id="create-issue-comment"
          aria-label="Comment"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Extra context to append to the issue body…"
          className="text-sm"
        />
      </div>

      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
