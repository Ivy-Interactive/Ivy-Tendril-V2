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
      className="flex items-center justify-between border-b border-amber-600/40 bg-amber-950/80 px-4 py-2 text-xs text-amber-200 backdrop-blur"
    >
      <div className="flex items-center space-x-2">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-ping" />
        <span className="font-semibold">
          {status === "reconnecting"
            ? `Tendril-Service disconnected. Auto-reconnecting in ${countdown}s...`
            : "Tendril-Service daemon is unreachable."}
        </span>
        <span className="text-amber-300/80">(Falling back to cached state)</span>
      </div>
      <button
        type="button"
        onClick={onReconnect}
        className="rounded bg-amber-600/60 px-3 py-1 text-xs font-medium text-amber-100 transition hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
      >
        Reconnect Now
      </button>
    </div>
  );
};
