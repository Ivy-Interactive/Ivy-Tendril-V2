import * as React from "react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useTranslation } from "@/i18n/uiJobs";
import { DialogShell, DialogShortcutHint } from "./DialogShell";

export interface ReportBugDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Sends the report. The caller owns the upload, its busy state and its failure; on success it
   * opens the issue and closes the dialog, as V1 does. Both values are trimmed, and `githubUser` is
   * absent when the field was left empty.
   */
  onSubmit: (description: string, githubUser?: string) => void | Promise<void>;
  isBusy?: boolean;
  /** Why the upload failed, shown in place. V1 raises a toast; here it stays with the form. */
  error?: string | null;
}

/**
 * V1's `Apps/Jobs/Dialogs/ReportBugDialog.cs`, opened by the Job Debug sheet's **Report Bug**.
 *
 * The report is public: the job's logs, its plan and a sanitized copy of the config go up as a
 * GitHub issue. The muted line under the title says exactly that before anything is typed, which is
 * the whole of the consent V1 asks for - so it is V1's sentence, word for word.
 *
 * `Send Report` is disabled until there is a description, and every control is disabled while the
 * upload is out, as V1's `.Disabled(isSubmitting)` does.
 */
export function ReportBugDialog({
  isOpen,
  onClose,
  onSubmit,
  isBusy = false,
  error,
}: ReportBugDialogProps) {
  const { t } = useTranslation("uiJobs");
  const [description, setDescription] = React.useState("");
  const [githubUser, setGithubUser] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setDescription("");
      setGithubUser("");
    }
  }, [isOpen]);

  const canSubmit = !isBusy && description.trim() !== "";

  const submit = () => {
    if (!canSubmit) return;
    const user = githubUser.trim();
    void onSubmit(description.trim(), user || undefined);
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("reportBug.title")}
      width="rem32"
      testId="report-bug-dialog"
      initialFocusRef={textareaRef}
      shortcut="Ctrl+Enter"
      onShortcut={canSubmit ? submit : undefined}
      description={t("reportBug.intro")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={submit} data-testid="dialog-confirm" disabled={!canSubmit}>
            {isBusy ? t("reportBug.busy") : t("reportBug.submit")}
            {canSubmit && <DialogShortcutHint shortcut="Ctrl+Enter" />}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Textarea
          ref={textareaRef}
          aria-label={t("reportBug.descriptionAriaLabel")}
          placeholder={t("reportBug.descriptionPlaceholder")}
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={isBusy}
          className="text-sm"
          data-testid="report-bug-description"
        />
        <Input
          aria-label={t("reportBug.githubUserAriaLabel")}
          placeholder={t("reportBug.githubUserPlaceholder")}
          value={githubUser}
          onChange={(event) => setGithubUser(event.target.value)}
          disabled={isBusy}
          autoComplete="username"
          data-testid="report-bug-github-user"
        />
      </div>
      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
