import { useEffect, useRef, useState } from "react";

const toMillis = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * How long a run has been going, ticking once a second while it is live.
 *
 * `frozenMs` is the finished figure and wins outright: once a run has reported how long it took, that
 * is the number, and nothing keeps ticking. Returns `null` when there is nothing to say — no start and
 * no reported duration — so a caller can leave the line out rather than render "0s".
 *
 * `paused` stops the clock without freezing it to a figure, which is what a finished run that never
 * reported its own duration needs: the last tick stands, and the timer does not run on past the end of
 * the thing it was timing.
 *
 * A stream's timestamps come from the agent's machine and `Date.now()` from this browser, so a server
 * running ahead of us would pin a fresh run at "0s" for its first seconds. The run is therefore
 * anchored on whichever is earlier: the start it reported, or the moment we first saw it.
 *
 * The interval lives in whichever component calls this, which is the point: a ticking value re-renders
 * its owner every second, so its owner must be a leaf. Calling it from a component that also renders a
 * long list re-renders the list once a second.
 */
export function useElapsedMs(
  startedAt: string | number | null | undefined,
  frozenMs?: number | null,
  paused = false,
): number | null {
  const startMs = toMillis(startedAt);
  const ticking = startMs != null && frozenMs == null && !paused;
  const [now, setNow] = useState(() => Date.now());

  const seen = useRef<{ key: number | null; at: number }>({ key: null, at: 0 });
  if (seen.current.key !== startMs) seen.current = { key: startMs, at: Date.now() };
  const anchor = startMs == null ? null : Math.min(startMs, seen.current.at);

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking, startMs]);

  if (frozenMs != null) return frozenMs;
  return anchor == null ? null : Math.max(0, now - anchor);
}
