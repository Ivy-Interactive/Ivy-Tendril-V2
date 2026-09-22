import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { NativeSelect } from "../ui/native-select";
import { Switch } from "../ui/switch";
import { DialogShell, DialogShortcutHint } from "./DialogShell";

export interface AutoAcceptSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** V1's `refreshToken.Refresh()`: the Auto-Accept badge reads the setting this dialog writes. */
  onSaved?: () => void;
  /** V1's `onRefresh`: a manual check imports issues, so the list behind the dialog is now stale. */
  onChecked?: () => void;
  /**
   * Reads the stored inbox settings, writes them, and runs a manual check.
   *
   * Injected because all three are daemon calls. The dialog owns the form, the interval options and
   * every visible state; it owns none of the transport.
   */
  loadSettings: () => Promise<{ autoAccept?: boolean; checkIntervalMinutes?: number } | undefined>;
  saveSettings: (settings: { autoAccept: boolean; checkIntervalMinutes: number }) => Promise<void>;
  runCheck: () => Promise<{ outcome?: string; imported: unknown[]; skipped: number }>;
  describeError?: (err: unknown) => string;
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
  loadSettings,
  saveSettings,
  runCheck,
  describeError = (err) => (err instanceof Error ? err.message : String(err)),
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
    void loadSettings()
      .then((inbox) => {
        if (cancelled) return;
        setAutoAccept(inbox?.autoAccept ?? false);
        setInterval(inbox?.checkIntervalMinutes ?? DEFAULT_INTERVAL);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
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
      const report = await runCheck();
      // The report is what V1's toast could not say: a sweep that found nothing and a sweep that was
      // already running both leave the list unchanged, and only one of them is worth waiting for.
      setCheckSummary(
        report.outcome === "AlreadyRunning"
          ? "A check is already running."
          : `Imported ${report.imported.length}, skipped ${report.skipped}.`,
      );
      onChecked?.();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsChecking(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await saveSettings({ autoAccept, checkIntervalMinutes: interval });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsSaving(false);
    }
  };

  // `ConfirmDialog`'s arming discipline, for the same reason it has one: the chord and its key cap
  // must agree with the button. Here the gate is not merely cosmetic — while the config read is
  // still in flight the two controls hold their defaults rather than the saved settings, so a
  // chord that fired through `isLoading` would write `false`/15 over whatever the operator had.
  const saveArmed = !isSaving && !isLoading;

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Auto-Accept Settings"
      testId="auto-accept-settings-dialog"
      initialFocusRef={switchRef}
      // The dialog's one mutation, so it is the primary the chord names. `Check Now` in the body is
      // a read that imports issues and is deliberately left on the mouse: it is not this dialog's
      // answer, and V1 does not treat it as one either.
      shortcut="Ctrl+Enter"
      onShortcut={saveArmed ? () => void handleSave() : undefined}
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
            {saveArmed && <DialogShortcutHint shortcut="Ctrl+Enter" />}
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
        <NativeSelect
          id="auto-accept-check-interval"
          aria-label="Check Interval"
          value={interval}
          disabled={isLoading}
          onChange={(event) => setInterval(Number(event.target.value))}
        >
          {INTERVAL_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </NativeSelect>
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
