import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  DebugWithAgentDialog,
  JobDebugSheet as JobDebugSheetView,
  ReportBugDialog,
  formatJobDebugPrompt,
} from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { NEW_CHAT_TITLE } from "../../state/chatLauncher";
import { uiStore } from "../../state/uiStore";
import { describeBridgeError, type JobDetail } from "../../types/api";

export interface JobDebugSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** The job's fetched detail. Absent while the read is out, which the sheet says. */
  job?: JobDetail;
}

/**
 * V1's `AgentBranding.Label` for the configured coding agent: its display name, or "Agent" when none
 * is configured - V1's `DefaultLabel`. A brand name, not copy, so it is not translated.
 */
const AGENT_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  copilot: "Copilot",
  gemini: "Gemini",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  cursor: "Cursor",
  apple: "Apple",
};

function agentLabel(agentId: string | undefined): string {
  const id = agentId?.trim().toLowerCase();
  if (!id) return "Agent";
  return AGENT_LABELS[id] ?? `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

/**
 * V1 compiles "Debug with {agent}" in only under `#if DEBUG` (`JobDebugSheet.cs`): it is a tool for
 * working on Tendril itself. A Vite dev build is this app's DEBUG.
 */
const DEBUG_WITH_AGENT_ENABLED = import.meta.env.DEV;

/**
 * The connected Job Debug sheet: V1's `Apps/Views/Sheets/JobDebugSheet.cs` with both of its header
 * dialogs.
 *
 * - **Report Bug** (`ReportBugDialog.cs`) sends the job's logs, plan and a sanitized config to a
 *   public GitHub issue through `bridge.reportJobBug` - `tendril report-bug --submit`, which is V1's
 *   `BugReportService` - and opens the issue it answers, as V1's `client.OpenUrl` does.
 * - **Debug with {agent}** (`DebugWithAgentDialog.cs`, DEBUG builds only) starts a chat with the job's
 *   debug details and the `/tendril-debug-job` skill, and closes the sheet, as V1's `closeSheet()`
 *   does.
 *
 * Any page that opens a job's debug sheet should render this rather than the library's bare sheet,
 * so the two buttons are there wherever the sheet is.
 */
export function JobDebugSheet({ isOpen, onClose, job }: JobDebugSheetProps) {
  const [reportOpen, setReportOpen] = React.useState(false);
  const [reportBusy, setReportBusy] = React.useState(false);
  const [reportError, setReportError] = React.useState<string | null>(null);

  const [debugOpen, setDebugOpen] = React.useState(false);
  const [debugBusy, setDebugBusy] = React.useState(false);
  const [debugError, setDebugError] = React.useState<string | null>(null);
  const [codingAgent, setCodingAgent] = React.useState<string | undefined>(undefined);

  // V1 reads `config.Settings.CodingAgent` for the button's label; read once when the sheet opens.
  React.useEffect(() => {
    if (!isOpen || !DEBUG_WITH_AGENT_ENABLED) return;
    let cancelled = false;
    bridge
      .getConfig()
      .then((config) => {
        if (!cancelled) setCodingAgent(config.codingAgent);
      })
      .catch(() => {
        // The label falls back to "Agent"; the button still works.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const label = agentLabel(codingAgent);

  const submitReport = async (description: string, githubUser?: string) => {
    if (!job) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const issueUrl = await bridge.reportJobBug(job.id, description, githubUser);
      setReportOpen(false);
      await openUrl(issueUrl).catch(() => {
        // The report is filed either way; a browser that would not open is not a failed report.
      });
    } catch (err) {
      setReportError(describeBridgeError(err));
    } finally {
      setReportBusy(false);
    }
  };

  const startDebugChat = async (focus?: string) => {
    if (!job) return;
    setDebugBusy(true);
    setDebugError(null);
    try {
      // V1's `ChatLauncher.Open(nav, config, prompt)`: the chat page, a new conversation, and the
      // prompt as its first message. Snapshotted from the job in hand, as V1 snapshots it, so the
      // chat starts even if the job is evicted meanwhile.
      const prompt = formatJobDebugPrompt(job, focus);
      const { chatStore } = await import("../../state/chatStore");
      uiStore.navigate({ appId: "chat" });
      await chatStore.createSession(NEW_CHAT_TITLE);
      await chatStore.sendMessage(prompt);
      setDebugOpen(false);
      onClose();
    } catch (err) {
      setDebugError(describeBridgeError(err));
    } finally {
      setDebugBusy(false);
    }
  };

  return (
    <>
      <JobDebugSheetView
        isOpen={isOpen}
        onClose={onClose}
        job={job}
        onReportBug={() => {
          setReportError(null);
          setReportOpen(true);
        }}
        onDebugWithAgent={
          DEBUG_WITH_AGENT_ENABLED
            ? () => {
                setDebugError(null);
                setDebugOpen(true);
              }
            : undefined
        }
        debugAgentLabel={label}
      />
      <ReportBugDialog
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
        isBusy={reportBusy}
        error={reportError}
      />
      {DEBUG_WITH_AGENT_ENABLED && (
        <DebugWithAgentDialog
          isOpen={debugOpen}
          onClose={() => setDebugOpen(false)}
          agentLabel={label}
          onConfirm={startDebugChat}
          isBusy={debugBusy}
          error={debugError}
        />
      )}
    </>
  );
}
