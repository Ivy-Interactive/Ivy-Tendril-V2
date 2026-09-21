import React from "react";
import { Button } from "@ivy-interactive/components/ui";

interface OfflineBannerProps {
  status: "online" | "reconnecting" | "offline";
  countdown: number;
  onReconnect: () => void;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ status, countdown, onReconnect }) => {
  if (status === "online") return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="offline-banner"
      className="flex items-center justify-between border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning backdrop-blur"
    >
      <div className="flex items-center space-x-2">
        <span className="inline-block size-2 rounded-full bg-warning animate-ping" />
        <span className="font-semibold">
          {status === "reconnecting"
            ? `Tendril-Service disconnected. Auto-reconnecting in ${countdown}s...`
            : "Tendril-Service daemon is unreachable."}
        </span>
        <span className="text-warning/80">(Falling back to cached state)</span>
      </div>
      {/* Keeps the banner's warning colour rather than taking `Button`'s solid `warning` fill —
          see the same note on `UpdateNotice`. */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onReconnect}
        className="bg-warning/60 text-xs text-warning hover:bg-warning/90 hover:text-warning"
      >
        Reconnect Now
      </Button>
    </div>
  );
};
