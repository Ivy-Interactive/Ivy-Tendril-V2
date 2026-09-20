import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button, Callout, Switch } from "@ivy-interactive/components/ui";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";
import { DialogShell } from "./DialogShell";
import { SELECT_FIELD_CLASS } from "./selectField";

export interface AutoAcceptSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** V1's `refreshToken.Refresh()`: the Auto-Accept badge reads the setting this dialog writes. */
  onSaved?: () => void;
  /** V1's `onRefresh`: a manual check imports issues, so the list behind the dialog is now stale. */
  onChecked?: () => void;
}

/** V1's `intervalOptions`, exactly. */
const INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;

/** What `Inbox.CheckIntervalMinutes` defaults to when the config has never carried one. */
const DEFAULT_INTERVAL = 15;

/**
 * Port of `Apps/Inbox/Dialogs/AutoAcceptSettingsDialog`.
 *
 * The interval is the reason this dialog has to exist: `inbox.checkIntervalMinutes` decides how often
 * the importer sweeps for newly assigned issues, and until now V2 had nowhere to set it — the Inbox
 * header shows the auto-accept state and nothing could change the schedule.
 *
 * Auto-accept is a `Switch` because V1 writes `ToSwitchInput` here rather than the checkbox
 * `ToBoolInput` gives by default; the interval is the same five-option select V1 offers.
 *
 * Both keys are written in one `putConfig("inbox", …)`: the service deep-merges the incoming object,
 * so an inbox key this dialog does not know about survives the write.
 */
export function AutoAcceptSettingsDialog({
  isOpen,
  onClose,
  onSaved,
  onChecked,
}: AutoAcceptSettingsDialogProps) {
  const [autoAccept, setAutoAccept] = React.useState(false);
  const [interval, setInterval] = React.useState<number>(DEFAULT_INTERVAL);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isChecking, setIsChecking] = React.useState(false);
  const [checkSummary, setCheckSummary] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const switchRef = React.useRef<HTMLButtonElement>(null);

  // V1 seeds its state from `config.Settings.Inbox` on every Build; the settings are already in
  // memory there. Here they are a request, so the dialog reads them each time it opens rather than
  // showing whatever the last open left behind.
  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setCheckSummary(null);
    void bridge
      .getConfig()
      .then((config) => {
        if (cancelled) return;
        setAutoAccept(config.inbox?.autoAcceptAssignedIssues ?? false);
        setInterval(config.inbox?.checkIntervalMinutes ?? DEFAULT_INTERVAL);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeBridgeError(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleCheckNow = async () => {
    setIsChecking(true);
    setError(null);
    setCheckSummary(null);
    try {
      const report = await bridge.checkInbox();
      // The report is what V1's toast could not say: a sweep that found nothing and a sweep that was
      // already running both leave the list unchanged, and only one of them is worth waiting for.
      setCheckSummary(
        report.outcome === "AlreadyRunning"
          ? "A check is already running."
          : `Imported ${report.imported.length}, skipped ${report.skipped}.`,
      );
      onChecked?.();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsChecking(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await bridge.putConfig("inbox", {
        autoAcceptAssignedIssues: autoAccept,
        checkIntervalMinutes: interval,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Auto-Accept Settings"
      testId="auto-accept-settings-dialog"
      initialFocusRef={switchRef}
      footer={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="dialog-cancel"
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            data-testid="dialog-confirm"
            disabled={isSaving || isLoading}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <p className="text-xs text-muted-foreground">
        Automatically import newly assigned GitHub issues into Tendril plans at regular intervals.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Switch
          ref={switchRef}
          id="auto-accept-assigned-issues"
          checked={autoAccept}
          onCheckedChange={setAutoAccept}
          disabled={isLoading}
          aria-label="Auto-Accept Assigned Issues"
        />
        <label htmlFor="auto-accept-assigned-issues" className="text-sm text-foreground">
          Auto-Accept Assigned Issues
        </label>
      </div>

      <div className="mt-4">
        <label
          htmlFor="auto-accept-check-interval"
          className="mb-1 block text-xs text-muted-foreground"
        >
          Check Interval
        </label>
        <select
          id="auto-accept-check-interval"
          aria-label="Check Interval"
          value={interval}
          disabled={isLoading}
          onChange={(event) => setInterval(Number(event.target.value))}
          className={SELECT_FIELD_CLASS}
        >
          {INTERVAL_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleCheckNow()}
          data-testid="auto-accept-check-now"
          disabled={isChecking}
        >
          <RefreshCw className={isChecking ? "animate-spin" : undefined} aria-hidden="true" />
          {isChecking ? "Checking…" : "Check Now"}
        </Button>
      </div>

      {checkSummary !== null && (
        <Callout.Success className="mt-3" data-testid="auto-accept-check-summary">
          {checkSummary}
        </Callout.Success>
      )}

      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
