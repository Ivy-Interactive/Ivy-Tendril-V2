import type * as React from "react";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { CopyToClipboardButton } from "../CopyToClipboardButton";
import { Trans, formatNumber, useTranslation } from "@/i18n/uiPanels";
import { DialogShell } from "./DialogShell";

export interface UpdateTendrilDialogProps {
  isOpen: boolean;
  /** Ignored while an update is running, as V1's dialog ignores its own close then. */
  onClose: () => void;
  currentVersion: string;
  latestVersion: string;
  /**
   * Whether this install can update itself. V1's `IVersionCheckService.CanSelfUpdate`. When it
   * cannot, the dialog shows {@link updateCommand} and an OK, and never offers Update Now.
   */
  canSelfUpdate: boolean;
  /** The terminal one-liner for this platform, shown when {@link canSelfUpdate} is false. */
  updateCommand: string;
  /** Update Now, and Retry after a failure. V1's `RunUpdate`. */
  onUpdate?: () => void;
  /**
   * The download/install progress, 0-100, while an update runs; `null` when none is running. V1's
   * `updateProgress`: a running update shows the bar and disables every way out.
   */
  progress?: number | null;
  /** The step the update is on ("Downloading..."), shown above the bar. V1's `updateStatus`. */
  statusText?: string | null;
  /** Why the last attempt failed. V1's `updateError`: shown with Retry and Cancel. */
  error?: string | null;
}

/**
 * The update dialog, opened from the update banner's Show Details. Port of V1
 * `AppShell/Dialogs/UpdateTendrilDialog.cs`.
 *
 * Four states, V1's four branches, in V1's order of precedence:
 *
 * 1. **Failed** (`error`): "Update Failed", the message, and Cancel / Retry.
 * 2. **Running** (`progress` set): the step, a progress bar and its percentage, and a single
 *    disabled "Updating..." - no Cancel, and Escape does nothing, because an update half-applied is
 *    worse than one not started. On success the app exits to apply it and restarts, so there is no
 *    "done" state to show.
 * 3. **Self-update available** (`canSelfUpdate`): what is new, what Update Now will do, and
 *    Cancel / Update Now.
 * 4. **Manual**: the terminal command for this platform with a copy button, and OK.
 *
 * Presentational: it runs nothing. The app's wrapper owns the update itself and feeds `progress`,
 * `statusText` and `error` back in.
 */
export function UpdateTendrilDialog({
  isOpen,
  onClose,
  currentVersion,
  latestVersion,
  canSelfUpdate,
  updateCommand,
  onUpdate,
  progress = null,
  statusText = null,
  error = null,
}: UpdateTendrilDialogProps) {
  const { t } = useTranslation("uiPanels");
  const isRunning = progress !== null && error === null;
  const close = () => {
    // V1: `_ => { if (updateProgress.Value == null) Close(); }`.
    if (!isRunning) onClose();
  };

  const available = (
    <p>
      <Trans
        ns="uiPanels"
        i18nKey="updateTendril.available"
        values={{ latest: latestVersion, current: currentVersion }}
        components={{ strong: <strong className="font-semibold text-foreground" /> }}
      />
    </p>
  );

  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (error !== null) {
    body = (
      <div className="space-y-2" data-testid="update-tendril-failed">
        <p className="text-sm font-semibold text-destructive">{t("updateTendril.failedTitle")}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{error}</p>
      </div>
    );
    footer = (
      <>
        <Button variant="outline" onClick={onClose} data-testid="dialog-cancel">
          {t("updateTendril.cancel")}
        </Button>
        <Button
          onClick={() => onUpdate?.()}
          disabled={!onUpdate}
          data-testid="update-tendril-retry"
        >
          {t("updateTendril.retry")}
        </Button>
      </>
    );
  } else if (progress !== null) {
    const percent = Math.max(0, Math.min(100, Math.round(progress)));
    body = (
      <div className="space-y-3" data-testid="update-tendril-progress">
        <p className="text-sm">{statusText || t("updateTendril.updating")}</p>
        <Progress value={percent} aria-label={t("updateTendril.progressLabel")} />
        <p className="text-sm text-muted-foreground">
          {/* V1: `Text.Muted($"{progressVal}%")`, in the language's own percent shape. */}
          {formatNumber(percent, { style: "unit", unit: "percent" })}
        </p>
      </div>
    );
    footer = (
      <Button disabled data-testid="update-tendril-running">
        {t("updateTendril.updating")}
      </Button>
    );
  } else if (canSelfUpdate) {
    body = (
      <div className="space-y-3 text-sm">
        {available}
        <p>{t("updateTendril.selfUpdateHint")}</p>
      </div>
    );
    footer = (
      <>
        <Button variant="outline" onClick={onClose} data-testid="dialog-cancel">
          {t("updateTendril.cancel")}
        </Button>
        <Button onClick={() => onUpdate?.()} disabled={!onUpdate} data-testid="update-tendril-now">
          {t("updateTendril.updateNow")}
        </Button>
      </>
    );
  } else {
    body = (
      <div className="space-y-3 text-sm" data-testid="update-tendril-manual">
        {available}
        <p>{t("updateTendril.manualHint")}</p>
        {/* V1's `new CodeBlock(updateCommand, Languages.Bash)`: its copy button is the code block's. */}
        <div className="flex items-start gap-2 rounded-field border border-border bg-muted/40 p-2">
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-6">
            <code data-testid="update-tendril-command">{updateCommand}</code>
          </pre>
          <CopyToClipboardButton textToCopy={updateCommand} />
        </div>
      </div>
    );
    footer = (
      <Button onClick={onClose} data-testid="dialog-ok">
        {t("updateTendril.ok")}
      </Button>
    );
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={close}
      // V1's `new DialogHeader("Update Tendril")` and `.Width(Size.Rem(32))`.
      title={t("updateTendril.title")}
      width="rem32"
      testId="update-tendril-dialog"
      footer={footer}
    >
      {body}
    </DialogShell>
  );
}
