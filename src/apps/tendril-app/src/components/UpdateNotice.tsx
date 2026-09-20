import React from "react";
import { Button } from "@ivy-interactive/components/ui";
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
        {/* The banner is one `info` surface, so its buttons keep that colour rather than taking
            `Button`'s own `info` variant, which would paint a solid fill inside an already tinted
            strip. What they take from `Button` is the shape, the height, the focus ring and the
            disabled behaviour — the parts that were being redrawn by hand at every call site. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCopyCommand}
          className="bg-info/60 text-xs text-info hover:bg-info/90 hover:text-info"
        >
          Copy Command
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onDismiss(info.latestVersion as string)}
          className="text-xs text-info hover:bg-info/20 hover:text-info"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
};
