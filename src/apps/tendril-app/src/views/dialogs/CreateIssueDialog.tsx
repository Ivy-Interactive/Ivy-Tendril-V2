import * as React from "react";
import { Button, Callout, Input, Textarea } from "@ivy-interactive/components/ui";
import { PlanActionsController } from "../../controllers/plan_actions";
import {
  describeBridgeError,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";
import { DialogShell } from "./DialogShell";
import { SELECT_FIELD_CLASS } from "./selectField";

/**
 * A subject that is not the plan: the issue is filed about this instead, and the plan only decides
 * where `gh` runs and which plan the job belongs to.
 *
 * Supplying one switches the dialog into subject mode, where Title and Body become editable fields
 * seeded from `title` and `body`. Without one the dialog behaves exactly as it always has and the
 * promptware builds the issue from the plan's own revision.
 */
export interface CreateIssueSubject {
  title: string;
  body: string;
  /** Stable identity, `planId::title` for a recommendation. Footer citation and dedupe key. */
  source: string;
  /** What kind of thing this is, for the dialog's heading. */
  kind: string;
}

export interface CreateIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * In subject mode this is the *source* plan — the one the recommendation came from. It is still
   * what resolves the repo list and the job's plan scope.
   */
  plan: PlanDetail | PlanSummary;
  /** Fallback when the plan records no repos of its own. */
  projectRepos?: string[];
  subject?: CreateIssueSubject;
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
  subject,
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
  const [title, setTitle] = React.useState(subject?.title ?? "");
  const [body, setBody] = React.useState(subject?.body ?? "");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // V1 puts `.AutoFocus()` on the repository select: it is the one required field, and the only one
  // that changes what the other two mean. Safe to focus here because nothing in this dialog is
  // destructive.
  const repoRef = React.useRef<HTMLSelectElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  /**
   * Seeded once per opening, deliberately not on `repos`/`subject` identity.
   *
   * Callers build both from their own render state — `projectRepos={projects.find(...)?.repos ?? []}`
   * and, for a recommendation, a fresh `subject` object — so neither is referentially stable across
   * a parent render. Keying the reset on them re-ran it mid-edit and discarded whatever the operator
   * had typed: in subject mode an edited title reverted to the recommendation's wording on the next
   * render, and in plan mode assignee, labels and comment were being cleared the same way.
   */
  const subjectRef = React.useRef(subject);
  subjectRef.current = subject;

  React.useEffect(() => {
    if (!isOpen) return;
    const seed = subjectRef.current;
    setAssignee("");
    setLabels("");
    setComment("");
    setTitle(seed?.title ?? "");
    setBody(seed?.body ?? "");
    setError(null);
    setIsBusy(false);
  }, [isOpen]);

  /**
   * The repo list can arrive after the dialog opens, because the projects it comes from load
   * asynchronously. Tracked apart from the seed above so a late arrival still fills the selection,
   * and only when the current one is absent or no longer offered — returning the same value makes
   * React bail out, so this stays quiet on the renders where nothing changed.
   */
  React.useEffect(() => {
    if (!isOpen) return;
    setRepo((current) => (current !== "" && repos.includes(current) ? current : (repos[0] ?? "")));
  }, [isOpen, repos]);

  const handleSubmit = async () => {
    if (!repo) return;
    // Subject mode needs a title: it is the only thing the promptware has to name the issue with,
    // since it will not be reading the plan's.
    if (subject && title.trim() === "") return;
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
        ...(subject
          ? {
              titleOverride: title.trim(),
              bodyOverride: body.trim() || undefined,
              issueSource: subject.source,
            }
          : {}),
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
      title={subject ? `Create GitHub Issue from ${subject.kind}` : `Create GitHub Issue #${plan.id}`}
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={() => void handleSubmit()}
      description={
        subject
          ? `CreateIssue opens this with \`gh\` in the selected repository. The issue is filed against plan #${plan.id}, but describes the ${subject.kind.toLowerCase()} rather than the plan's own work.`
          : "CreateIssue writes the issue body from the plan and opens it with `gh` in the selected repository."
      }
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
            disabled={isBusy || repo === "" || (subject != null && title.trim() === "")}
          >
            {isBusy ? "Starting…" : "Create Issue"}
          </Button>
        </>
      }
    >
      {subject && (
        <>
          <div className="mb-4">
            <label htmlFor="create-issue-title" className="mb-1 block text-xs text-muted-foreground">
              Title
            </label>
            <Input
              id="create-issue-title"
              aria-label="Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What the issue is about"
              data-testid="create-issue-title"
            />
            {title.trim() === "" && (
              <p className="mt-1 text-xs text-warning">
                A title is required: the plan&apos;s own title is not used here.
              </p>
            )}
          </div>

          <div className="mb-4">
            <label htmlFor="create-issue-body" className="mb-1 block text-xs text-muted-foreground">
              Body
            </label>
            <Textarea
              id="create-issue-body"
              aria-label="Body"
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What should be done, and why…"
              className="text-sm"
              data-testid="create-issue-body"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Edit before filing if the wording is terse. The agent formats it into Markdown and
              keeps your words rather than rewriting them.
            </p>
          </div>
        </>
      )}

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
