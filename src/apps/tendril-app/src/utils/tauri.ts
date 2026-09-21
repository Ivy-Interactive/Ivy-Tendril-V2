/**
 * Whether the app is running inside the Tauri host, as opposed to a plain browser tab.
 *
 * A leaf module with no other project imports, so both `api/bridge.ts` and `api/events.ts` can
 * import it without the load-order cycle that came from `bridge.ts` importing `events.ts`: the two
 * used to carry byte-identical copies of this check for exactly that reason.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Encodes raw bytes for the daemon's `input` route, which takes base64 for the same reason `log` does. */
export function encodeBase64(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
