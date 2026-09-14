import React from "react";
import type { VersionInfo } from "../types/api";

interface UpdateNoticeProps {
  info: VersionInfo | null;
  dismissedVersion: string | null;
  onDismiss: (version: string) => void;
  onCopyCommand: () => void;
}

export const UpdateNotice: React.FC<UpdateNoticeProps> = ({
  info,
  dismissedVersion,
  onDismiss,
  onCopyCommand,
}) => {
  if (!info || !info.hasUpdate || !info.latestVersion) return null;
  if (info.latestVersion === dismissedVersion) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="update-notice"
      className="flex items-center justify-between border-b border-info/40 bg-info/10 px-4 py-2 text-xs text-info backdrop-blur"
    >
      <div className="flex items-center space-x-2">
        <span className="font-semibold">
          v{info.latestVersion} is available (you have v{info.currentVersion})
        </span>
      </div>
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={onCopyCommand}
          className="rounded bg-info/60 px-3 py-1 text-xs font-medium text-info transition hover:bg-info/90 focus:outline-none focus:ring-2 focus:ring-info"
        >
          Copy Command
        </button>
        <button
          type="button"
          onClick={() => onDismiss(info.latestVersion as string)}
          className="rounded px-3 py-1 text-xs font-medium text-info transition hover:bg-info/20 focus:outline-none focus:ring-2 focus:ring-info"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
