/**
 * Polling fallback intervals used when no realtime stream is connected. The stream that matters is
 * the filesystem change stream: the daemon watches the Plans folder and pushes coalesced events over
 * `/api/changes/events`, which `service/changes_bridge.rs` consumes natively and re-emits as Tauri
 * events. (The WebSocket bridge in `service/ws_bridge.rs` is not wired up.) So the frontend only
 * needs to decide how aggressively to re-poll while those events are not arriving.
 */
export function getPollingInterval(
  isRealtimeConnected: boolean,
  resource: "jobs" | "plans",
): number | false {
  if (isRealtimeConnected) {
    return false; // Realtime updates arrive via the native change-stream bridge
  }

  // Polling fallback when disconnected/reconnecting:
  // 3s for active jobs, 5s for plan lists
  return resource === "jobs" ? 3000 : 5000;
}
