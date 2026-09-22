import { AutoAcceptSettingsDialog as AutoAcceptSettingsDialogView } from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";

export interface AutoAcceptSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** V1's `refreshToken.Refresh()`: the Auto-Accept badge reads the setting this dialog writes. */
  onSaved?: () => void;
  /** V1's `onRefresh`: a manual check imports issues, so the list behind the dialog is now stale. */
  onChecked?: () => void;
}

/**
 * The connected half of `AutoAcceptSettingsDialog`.
 *
 * Three daemon calls live here — reading the stored inbox settings, writing them, and running a
 * manual check. The dialog owns the form, the interval options and every visible state, including
 * the arming rule that keeps a Ctrl+Enter from writing defaults over the saved settings while the
 * read is still in flight.
 *
 * The read reshapes `config.inbox` into the two fields the dialog actually uses, so the view never
 * sees the config envelope.
 */
export function AutoAcceptSettingsDialog({
  isOpen,
  onClose,
  onSaved,
  onChecked,
}: AutoAcceptSettingsDialogProps) {
  return (
    <AutoAcceptSettingsDialogView
      isOpen={isOpen}
      onClose={onClose}
      onSaved={onSaved}
      onChecked={onChecked}
      loadSettings={async () => {
        const config = await bridge.getConfig();
        return {
          autoAccept: config.inbox?.autoAcceptAssignedIssues,
          checkIntervalMinutes: config.inbox?.checkIntervalMinutes,
        };
      }}
      saveSettings={async ({ autoAccept, checkIntervalMinutes }) => {
        await bridge.putConfig("inbox", {
          autoAcceptAssignedIssues: autoAccept,
          checkIntervalMinutes,
        });
      }}
      runCheck={() => bridge.checkInbox()}
      describeError={describeBridgeError}
    />
  );
}
