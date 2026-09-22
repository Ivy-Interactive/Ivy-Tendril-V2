import * as React from "react";
import { Callout } from "../ui/callout";
import { Input } from "../ui/input";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DeleteProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The project's stored name. Also the path segment the route is addressed by, and the phrase to type. */
  projectName: string;
  /** Deletes the project's data. The caller owns the request, its busy state and its failure. */
  onConfirm: () => void | Promise<void>;
  isBusy?: boolean;
  /** A backend rejection, shown where the operator pressed the button. */
  error?: string | null;
}

/**
 * Whether what was typed authorises deleting `projectName`.
 *
 * Trimmed and case-insensitive, matching how the daemon finds the project: `purge_project` selects
 * with `eq_ignore_ascii_case`, so `DOOMED` addresses the project stored as `Doomed`. A gate stricter
 * than the route it guards would only be a spelling test - the point is that the operator names the
 * project, not that they reproduce its capitalisation.
 *
 * Exported for the test that pins it, because the gate is the safety property of this dialog and
 * deserves to be asserted as a function as well as through the DOM.
 */
export function confirmsProjectName(typed: string, projectName: string): boolean {
  const target = projectName.trim();
  return target !== "" && typed.trim().toLowerCase() === target.toLowerCase();
}

/**
 * The Danger Zone's irreversible half: `DELETE /api/projects/:name/data`, which deletes the
 * project's data from disk rather than forgetting the project.
 *
 * {@link RemoveProjectDialog} is the reversible one, and the split is the whole point. Until now
 * there was a single action labelled "Delete Project" that only removed the `config.yaml` entry, so
 * the label promised something the code never did and a paragraph of copy was the only correction.
 * Now the label is the verb: Remove forgets, Delete deletes.
 *
 * What the daemon removes, in the order it removes it - every plan folder naming the project, with
 * `git worktree` cleaned first so no repository is left with a dangling registration;
 * `<TENDRIL_HOME>/Projects/<name>/` and the clones, skills, MCP definitions and memories inside it;
 * the project's rows in `Plans`, `Jobs` and `Recommendations`; and the `config.yaml` entry **last**,
 * so a crash partway leaves a project that is still listed rather than directories nothing can name.
 * Job logs under `Logs/Jobs/` are keyed by job id rather than by project, and are kept - said below,
 * because a promise of total deletion that is not quite true is worse than an exact one.
 *
 * It is refused with 409 while any job of the project is still running. That message is rendered in
 * place rather than swallowed: the answer is to stop the job, not to press the button again.
 *
 * **The typed-name gate is the one deliberate departure from `ConfirmDialog`'s point 4** ("nothing
 * to type"), which is otherwise the rule every confirm in this app follows, and it is taken through
 * the primitive's own `children` + `confirmDisabled` rather than around it - `children` is documented
 * as "extra controls below the body, e.g. the delete confirmation field", and `confirmArmed` already
 * withholds the Ctrl+Enter chord and its key cap while the confirm is disabled, so the gate closes
 * the keyboard path as well as the button without this file knowing about either.
 *
 * Point 4 is right for every other confirm here because they are all recoverable: a removed project
 * is re-added by name, a deleted plan folder is the plan's own work. This one is not - it deletes
 * repositories the operator may have local commits in, and it is reached from the same Danger Zone,
 * one button along, as the harmless one. Framework cannot express the gate at all (`WithConfirm`
 * takes a message and a label), and V1 has no destructive project action to copy, so the weight has
 * to be chosen here. Typing the name makes the two buttons impossible to confuse by a slip.
 */
export function DeleteProjectDialog({
  isOpen,
  onClose,
  projectName,
  onConfirm,
  isBusy,
  error,
}: DeleteProjectDialogProps) {
  const [typed, setTyped] = React.useState("");

  React.useEffect(() => {
    if (isOpen) setTyped("");
  }, [isOpen]);

  const armed = confirmsProjectName(typed, projectName);

  const handleDelete = () => {
    // Re-checked rather than trusted from the disabled button: `onConfirm` is also what the
    // Ctrl+Enter chord calls, and a guard that lives only in a `disabled` prop is one refactor away
    // from being no guard at all.
    if (!armed) return;
    void onConfirm();
  };

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Project"
      testId="delete-project-dialog"
      width="rem40"
      confirmLabel="Delete Project"
      confirmVariant="destructive"
      onConfirm={handleDelete}
      isBusy={isBusy}
      error={error}
      confirmDisabled={!armed}
      body={
        <>
          <p>
            This permanently deletes project <span className="text-foreground">{projectName}</span>{" "}
            and everything it owns on disk. It cannot be undone.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Every plan of this project, with its revisions and verification reports.</li>
            <li>
              <code>{"<TENDRIL_HOME>/Projects/"}</code>
              <code>{projectName}</code> — its cloned repositories, skills, MCP definitions and
              memories, including any commit that was never pushed.
            </li>
            <li>Its plans, jobs and recommendations in Tendril&apos;s database.</li>
            <li>Its entry in config.yaml.</li>
          </ul>
          <p className="text-muted-foreground">
            Job logs are kept: they are stored by job id rather than by project.
          </p>
          <Callout.Warning data-testid="delete-project-data-warning">
            To remove the project from Tendril without touching anything on disk, cancel and use
            Remove Project instead.
          </Callout.Warning>
        </>
      }
    >
      <div className="mt-4">
        <label
          htmlFor="delete-project-confirm"
          className="mb-1 block text-xs text-muted-foreground"
        >
          Type <span className="font-mono text-foreground">{projectName}</span> to confirm
        </label>
        <Input
          id="delete-project-confirm"
          aria-label={`Type ${projectName} to confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={projectName}
          autoComplete="off"
          data-testid="delete-project-confirm"
          disabled={isBusy}
        />
      </div>
    </ConfirmDialog>
  );
}
