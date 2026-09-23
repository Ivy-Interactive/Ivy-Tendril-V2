import React, { useState } from "react";
import { type TFunction, useTranslation } from "@/i18n/uiShell";

interface ToolCall {
  name: string;
  description?: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

interface ToolUseCardProps {
  tool: ToolCall;
}

function getStringParam(input: Record<string, unknown>, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const k of keys) {
    const val = input[k];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

/**
 * The IN block's text. The parameter names read below are the agents' own protocol names; only the
 * labels in front of the values are translated.
 */
function displayInput(t: TFunction, name: string, input: Record<string, unknown>): string {
  if (!input) return "";
  const normName = name.toLowerCase();

  const command = getStringParam(input, ["command", "CommandLine"]);
  if (command && (normName === "bash" || normName === "run_command" || normName === "command")) {
    return command;
  }

  const filePath = getStringParam(input, ["file_path", "AbsolutePath", "TargetFile", "path"]);
  if (filePath) {
    if (
      normName === "write" ||
      normName === "edit" ||
      normName === "write_to_file" ||
      normName === "replace_file_content" ||
      normName === "multi_replace_file_content"
    ) {
      let s = t("toolCard.file", { path: filePath });
      const content = getStringParam(input, [
        "content",
        "CodeContent",
        "ReplacementContent",
        "Instruction",
      ]);
      if (content) {
        s += `\n${content.slice(0, 500)}${content.length > 500 ? "\n…" : ""}`;
      }
      return s;
    }
    if (normName === "read" || normName === "view_file") {
      return t("toolCard.file", { path: filePath });
    }
  }

  const url = getStringParam(input, ["Url", "url"]);
  if (url) return t("toolCard.url", { url });

  const query = getStringParam(input, ["Query", "query"]);
  const searchPath = getStringParam(input, ["SearchPath", "search_path"]);
  if (query) {
    return searchPath
      ? t("toolCard.queryInPath", { query, path: searchPath })
      : t("toolCard.query", { query });
  }

  return JSON.stringify(input, null, 2);
}

export function inputSummary(tool: ToolCall): string {
  if (tool.description) return tool.description;
  const { input } = tool;
  if (!input) return "";

  const desc = getStringParam(input, ["description", "Instruction", "Description"]);
  if (desc) return desc;

  const cmd = getStringParam(input, ["command", "CommandLine"]);
  if (cmd) return cmd;

  const path = getStringParam(input, [
    "file_path",
    "AbsolutePath",
    "TargetFile",
    "SearchPath",
    "DirectoryPath",
    "path",
  ]);
  if (path) return path;

  const query = getStringParam(input, ["Query", "query", "pattern"]);
  if (query) return query;

  const url = getStringParam(input, ["Url", "url"]);
  if (url) return url;

  return "";
}

const ChevronDownIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="14"
    height="14"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

type ToolStatus = "running" | "success" | "error";

function getToolStatus(tool: ToolCall): ToolStatus {
  if (tool.result === undefined) return "running";
  if (tool.isError) return "error";
  return "success";
}

export const ToolUseCard: React.FC<ToolUseCardProps> = ({ tool }) => {
  const { t } = useTranslation("uiShell");
  const status = getToolStatus(tool);
  const [open, setOpen] = useState(false);

  const handleToggle = () => setOpen((o) => !o);

  const summary = inputSummary(tool);
  let headerPreview = summary || "";
  if (tool.result != null && tool.result.length > 0) {
    const firstLine = tool.result.split("\n")[0].slice(0, 80);
    const hasWeirdChars = /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬]/.test(firstLine);
    if (firstLine.trim() && (tool.isError || !hasWeirdChars)) {
      headerPreview = headerPreview ? `${headerPreview} → ${firstLine}` : firstLine;
    }
  }

  return (
    <div className={`aov-tool ${open ? "open" : ""}`}>
      <div
        className="aov-tool-header"
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <span className={`aov-tool-chevron ${open ? "open" : ""}`}>
          <ChevronDownIcon />
        </span>
        <span className={`aov-tool-status aov-tool-status--${status}`} />
        <span className="aov-tool-name">{tool.name}</span>
        {headerPreview && <span className="aov-tool-preview">{headerPreview}</span>}
      </div>
      {open && (
        <div className="aov-tool-body">
          <div className="aov-tool-section">
            <span className="aov-tool-label">{t("toolCard.input")}</span>
            <pre className="aov-tool-pre">
              <code>{displayInput(t, tool.name, tool.input)}</code>
            </pre>
          </div>
          {tool.result != null && tool.result.length > 0 && (
            <div className="aov-tool-section">
              <span className="aov-tool-label">{t("toolCard.output")}</span>
              <pre className="aov-tool-pre">
                <code>{tool.result}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
