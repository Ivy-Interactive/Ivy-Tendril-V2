import React from "react";

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
        <span className="inline-block h-2 w-2 rounded-full bg-warning animate-ping" />
        <span className="font-semibold">
          {status === "reconnecting"
            ? `Tendril-Service disconnected. Auto-reconnecting in ${countdown}s...`
            : "Tendril-Service daemon is unreachable."}
        </span>
        <span className="text-warning/80">(Falling back to cached state)</span>
      </div>
      <button
        type="button"
        onClick={onReconnect}
        className="rounded bg-warning/60 px-3 py-1 text-xs font-medium text-warning transition hover:bg-warning/90 focus:outline-none focus:ring-2 focus:ring-warning"
      >
        Reconnect Now
      </button>
    </div>
  );
};
