import * as React from "react";
import { Bug } from "lucide-react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Textarea } from "../ui/textarea";
import { useTranslation } from "@/i18n/uiJobs";
import { DialogShell, DialogShortcutHint } from "./DialogShell";

export interface DebugWithAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The configured coding agent's name, V1's `AgentBranding.Label` ("Claude", "Codex", …). */
  agentLabel: string;
  /** Beside the confirm label, V1's `branding.Icon`. A bug by default. */
  agentIcon?: React.ReactNode;
  /**
   * Opens the chat. `focus` is trimmed, and absent when the operator left the box empty - V1's
   * `string.IsNullOrWhiteSpace(focus) ? null : focus.Trim()`.
   */
  onConfirm: (focus?: string) => void | Promise<void>;
  isBusy?: boolean;
  error?: string | null;
}

/**
 * V1's `Apps/Jobs/Dialogs/DebugWithAgentDialog.cs`, opened by the Job Debug sheet's "Debug with
 * {agent}" button - which V1 compiles in only under `#if DEBUG`, as a tool for working on Tendril
 * itself rather than an operator feature.
 *
 * One optional question - is there anything in particular to look for - and a confirm that starts a
 * chat with the job's debug details and the `/tendril-debug-job` skill. The prompt is the caller's
 * to build; this only collects the focus.
 */
export function DebugWithAgentDialog({
  isOpen,
  onClose,
  agentLabel,
  agentIcon,
  onConfirm,
  isBusy = false,
  error,
}: DebugWithAgentDialogProps) {
  const { t } = useTranslation("uiJobs");
  const [focus, setFocus] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isOpen) setFocus("");
  }, [isOpen]);

  const confirm = () => {
    if (isBusy) return;
    const trimmed = focus.trim();
    void onConfirm(trimmed || undefined);
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("debugWithAgent.title", { agent: agentLabel })}
      width="rem32"
      testId="debug-with-agent-dialog"
      initialFocusRef={textareaRef}
      shortcut="Ctrl+Enter"
      onShortcut={isBusy ? undefined : confirm}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={confirm} data-testid="dialog-confirm" disabled={isBusy}>
            {agentIcon ?? <Bug aria-hidden="true" />}
            {t("debugWithAgent.confirm", { agent: agentLabel })}
            {!isBusy && <DialogShortcutHint shortcut="Ctrl+Enter" />}
          </Button>
        </>
      }
    >
      <Textarea
        ref={textareaRef}
        aria-label={t("debugWithAgent.focusAriaLabel")}
        placeholder={t("debugWithAgent.focusPlaceholder")}
        rows={3}
        value={focus}
        onChange={(event) => setFocus(event.target.value)}
        disabled={isBusy}
        className="text-sm"
        data-testid="debug-with-agent-focus"
      />
      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
