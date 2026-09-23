import { i18n } from "@/i18n/uiShell";
import type { PresentationEvent } from "./types.ts";

/** Bound to this namespace and to the language current at each call, so safe at module level. */
const t = i18n.getFixedT(null, "uiShell");

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export interface DerivedStatus {
  text: string;
  complete: boolean;
}

/**
 * The status line for a run, in the language current when it is called. A `status` event's text is
 * the agent's own and is shown as it arrived.
 */
export function deriveStatus(events: PresentationEvent[]): DerivedStatus {
  if (events.length === 0) return { text: t("agentStatus.starting"), complete: false };

  const last = events[events.length - 1];
  if (last.kind === "result") {
    return {
      text: last.wire.is_success ? t("agentStatus.completed") : t("agentStatus.failed"),
      complete: true,
    };
  }

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "tool-use" && e.tool.result === undefined) {
      return { text: labelForTool(e.tool.name, e.tool.input), complete: false };
    }
  }

  if (last.kind === "status") return { text: last.text, complete: false };
  if (last.kind === "assistant-text") return { text: t("agentStatus.thinking"), complete: false };
  if (last.kind === "thinking") return { text: t("agentStatus.thinking"), complete: false };
  return { text: t("agentStatus.working"), complete: false };
}

function labelForTool(name: string, input: Record<string, unknown>): string {
  const filePath = typeof input.file_path === "string" ? input.file_path : undefined;
  // `name` is the agent's tool name, a protocol value: matched here, and shown untranslated.
  switch (name) {
    case "Bash":
      return t("agentStatus.runningCommand");
    case "Read":
      return filePath
        ? t("agentStatus.readingFile", { file: basename(filePath) })
        : t("agentStatus.reading");
    case "Edit":
    case "Write":
      return filePath
        ? t("agentStatus.editingFile", { file: basename(filePath) })
        : t("agentStatus.editing");
    case "Glob":
    case "Grep":
      return t("agentStatus.searching");
    default:
      return t("agentStatus.runningTool", { name });
  }
}
