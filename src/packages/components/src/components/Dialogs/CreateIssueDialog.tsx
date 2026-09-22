import * as React from "react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Input } from "../ui/input";
import { NativeSelect } from "../ui/native-select";
import { Textarea } from "../ui/textarea";
import { Trans, useTranslation } from "@/i18n/uiDialogs";
import { DialogShell } from "./DialogShell";

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
  /**
   * What kind of thing this is, as the app names it: `"Recommendation"`. A kind listed in
   * {@link SUBJECT_CONTEXTS} gets a title and description of its own as whole sentences, so each
   * language can inflect and capitalise the noun as its grammar needs - pass it untranslated. Any
   * other value gets a generic sentence that shows it as given in the title and lower-cased in the
   * description, as the English has always read.
   */
  kind: string;
}

/**
 * The subject kinds with a title and description of their own, by `kind` exactly as the app passes
 * it: the catalog's `createIssue.titleForSubject_<context>` and
 * `createIssue.descriptionForSubject_<context>`. The match is exact so that every other spelling
 * keeps the generic sentences' English byte for byte.
 */
const SUBJECT_CONTEXTS: Readonly<Record<string, string>> = {
  Recommendation: "recommendation",
};

function subjectContext(kind: string): string | undefined {
  return Object.hasOwn(SUBJECT_CONTEXTS, kind) ? SUBJECT_CONTEXTS[kind] : undefined;
}

/** What the form collects, handed to the app to dispatch. */
export interface CreateIssueSubmit {
  repo: string;
  assignee?: string;
  labels: string[];
  comment?: string;
  titleOverride?: string;
  bodyOverride?: string;
  issueSource?: string;
}

export interface CreateIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * In subject mode this is the *source* plan — the one the recommendation came from. It is still
   * what resolves the repo list and the job's plan scope.
   */
  /** The plan's id, as it appears in the title and the description. */
  planId: string;
  /** Repositories to choose between — the plan's own, or the project's when it records none. */
  repos: string[];
  /** Fallback when the plan records no repos of its own. */
  subject?: CreateIssueSubject;
  /** Dispatches CreateIssue. The app owns the request, its busy state and its failure. */
  onSubmit: (args: CreateIssueSubmit) => void | Promise<void>;
  isBusy?: boolean;
  error?: string | null;
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
  planId,
  repos,
  subject,
  onSubmit,
  isBusy = false,
  error,
}: CreateIssueDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const [repo, setRepo] = React.useState(repos[0] ?? "");
  const [assignee, setAssignee] = React.useState("");
  const [labels, setLabels] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [title, setTitle] = React.useState(subject?.title ?? "");
  const [body, setBody] = React.useState(subject?.body ?? "");
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

  const handleSubmit = () => {
    if (!repo) return;
    // Subject mode needs a title: it is the only thing the promptware has to name the issue with,
    // since it will not be reading the plan's.
    if (subject && title.trim() === "") return;
    const labelList = labels
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");

    void onSubmit({
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
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={
        subject
          ? t("createIssue.titleForSubject", {
              context: subjectContext(subject.kind),
              kind: subject.kind,
            })
          : t("createIssue.title", { planId })
      }
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={() => handleSubmit()}
      description={
        subject
          ? t("createIssue.descriptionForSubject", {
              context: subjectContext(subject.kind),
              planId,
              // Only the generic sentence shows it; lower-cased there as it always has been.
              kind: subject.kind.toLowerCase(),
            })
          : t("createIssue.description")
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
            {t("actions.cancel")}
          </Button>
          <Button
            onClick={() => handleSubmit()}
            data-testid="dialog-confirm"
            disabled={isBusy || repo === "" || (subject != null && title.trim() === "")}
          >
            {isBusy ? t("status.starting") : t("createIssue.submit")}
          </Button>
        </>
      }
    >
      {subject && (
        <>
          <div className="mb-4">
            <label
              htmlFor="create-issue-title"
              className="mb-1 block text-xs text-muted-foreground"
            >
              {t("createIssue.issueTitle.label")}
            </label>
            <Input
              id="create-issue-title"
              aria-label={t("createIssue.issueTitle.label")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("createIssue.issueTitle.placeholder")}
              data-testid="create-issue-title"
            />
            {title.trim() === "" && (
              <p className="mt-1 text-xs text-warning">{t("createIssue.issueTitle.required")}</p>
            )}
          </div>

          <div className="mb-4">
            <label htmlFor="create-issue-body" className="mb-1 block text-xs text-muted-foreground">
              {t("createIssue.body.label")}
            </label>
            <Textarea
              id="create-issue-body"
              aria-label={t("createIssue.body.label")}
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("createIssue.body.placeholder")}
              className="text-sm"
              data-testid="create-issue-body"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("createIssue.body.hint")}</p>
          </div>
        </>
      )}

      <div>
        <label htmlFor="create-issue-repo" className="mb-1 block text-xs text-muted-foreground">
          {t("createIssue.repository.label")}
        </label>
        {repos.length === 0 ? (
          <p className="text-sm text-warning" data-testid="create-issue-no-repos">
            <Trans
              ns="uiDialogs"
              i18nKey="createIssue.repository.none"
              values={{ command: "gh" }}
              components={{ code: <code /> }}
            />
          </p>
        ) : (
          <NativeSelect
            id="create-issue-repo"
            ref={repoRef}
            aria-label={t("createIssue.repository.label")}
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
          >
            {repos.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </NativeSelect>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{t("createIssue.repository.hint")}</p>
      </div>

      <div className="mt-4">
        <label htmlFor="create-issue-assignee" className="mb-1 block text-xs text-muted-foreground">
          {t("createIssue.assignee.label")}
        </label>
        <Input
          id="create-issue-assignee"
          aria-label={t("createIssue.assignee.label")}
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
          placeholder="octocat"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="create-issue-labels" className="mb-1 block text-xs text-muted-foreground">
          {t("createIssue.labels.label")}
        </label>
        <Input
          id="create-issue-labels"
          aria-label={t("createIssue.labels.label")}
          value={labels}
          onChange={(event) => setLabels(event.target.value)}
          placeholder="bug, ui"
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("createIssue.labels.hint")}</p>
      </div>

      <div className="mt-4">
        <label htmlFor="create-issue-comment" className="mb-1 block text-xs text-muted-foreground">
          {t("createIssue.comment.label")}
        </label>
        <Textarea
          id="create-issue-comment"
          aria-label={t("createIssue.comment.label")}
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t("createIssue.comment.placeholder")}
          className="text-sm"
        />
      </div>

      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
