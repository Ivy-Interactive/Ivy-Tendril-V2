/**
 * Polling fallback intervals used when the realtime WebSocket bridge is not
 * connected. The bridge lives in the native layer (`service/ws_bridge.rs`) and
 * forwards events as Tauri events, so the frontend only needs to decide how
 * aggressively to re-poll while those events are not arriving.
 */
export function getPollingInterval(
  isWsConnected: boolean,
  resource: "jobs" | "plans",
): number | false {
  if (isWsConnected) {
    return false; // Realtime updates arrive via the native WebSocket bridge
  }

  // Polling fallback when disconnected/reconnecting:
  // 3s for active jobs, 5s for plan lists
  return resource === "jobs" ? 3000 : 5000;
}
