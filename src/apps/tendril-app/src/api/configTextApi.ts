/**
 * `config.yaml` as raw text, for the in-app editor: `GET`/`PUT /api/config/text`.
 *
 * Separate from `bridge.ts`'s `getConfig`, which speaks `TendrilConfigDto`. That one is a parsed
 * tree, and a serde round-trip loses the comments, key order and blank lines the operator wrote —
 * the exact loss this editor exists to prevent, and what V1's `RawConfigEditorView.cs` avoided by
 * reading the file directly. These two calls carry the file's own bytes and nothing re-renders them
 * from a tree.
 *
 * The transport follows `agentsApi.ts`: Tauri IPC inside the shell, because only the Rust side holds
 * the daemon's bearer secret, and `fetch` outside it, which the dev server proxies. The two are
 * exclusive rather than a fallback chain — a failed `invoke` inside the shell is a real failure, and
 * retrying it over `fetch` would only replace the reason with a confusing one.
 *
 * Secrets never reach here. The daemon masks them before serving the text and resolves the mask
 * sentinels back to the stored values on write, so nothing in this module has a credential to leak —
 * as long as it stays true that no error message is built from the text being sent. `readError` is
 * written to that rule: the fallback names the path and the status, never the body.
 */

import { invoke } from "@tauri-apps/api/core";

/** `GET /api/config/text`. `maskedPaths` is document order, e.g. `llm.apiKey`. */
export interface MaskedConfigText {
  text: string;
  maskedPaths: string[];
}

/** Reads the masked config text. Swapped in tests. */
export type ConfigTextTransport = () => Promise<MaskedConfigText>;

/** Writes edited config text back. Swapped in tests. */
export type ConfigTextWriteTransport = (text: string) => Promise<void>;

/** Whether the shell is around us. The same test `bridge.ts` and `agentsApi.ts` use. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const PATH = "/api/config/text";

/**
 * The daemon's own `error` string, or a reason built only from the path and the status.
 *
 * Deliberately never the request body. Mid-edit that body can hold an API key the operator has typed
 * and not yet saved, and an error line is the easiest place in the app for one to end up on screen
 * or in a bug report. The daemon's `error` is safe by construction: it re-runs a failed validation
 * against the still-masked submission so the message it returns carries placeholders.
 */
async function readError(response: Response): Promise<string> {
  const detail = await response
    .json()
    .then((payload: { error?: string }) => payload.error)
    .catch(() => undefined);
  return detail ?? `Request to ${PATH} failed (${response.status})`;
}

const httpRead: ConfigTextTransport = async () => {
  if (isTauri()) {
    return await invoke<MaskedConfigText>("cmd_get_config_text");
  }

  const response = await fetch(PATH, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as MaskedConfigText;
};

const httpWrite: ConfigTextWriteTransport = async (text) => {
  if (isTauri()) {
    await invoke("cmd_put_config_text", { text });
    return;
  }

  const response = await fetch(PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(await readError(response));
};

let readTransport: ConfigTextTransport = httpRead;
let writeTransport: ConfigTextWriteTransport = httpWrite;

export function setConfigTextTransports(next: {
  read?: ConfigTextTransport;
  write?: ConfigTextWriteTransport;
}): void {
  if (next.read) readTransport = next.read;
  if (next.write) writeTransport = next.write;
}

export function resetConfigTextTransports(): void {
  readTransport = httpRead;
  writeTransport = httpWrite;
}

export const configTextApi = {
  /**
   * `config.yaml` verbatim, with every secret replaced by the mask sentinel.
   *
   * Rejects rather than returning a partially masked file: the daemon fails this route closed when
   * it cannot identify a secret's value confidently — a block scalar under a secret key, say — and
   * the reason it gives is what the editor's error line should show.
   */
  read(): Promise<MaskedConfigText> {
    return readTransport();
  },

  /**
   * Writes the edited text back, sentinels and all.
   *
   * An untouched sentinel is resolved daemon-side from the stored value by path; one the operator
   * overtyped writes through as a new secret. Nothing here needs to tell those apart, which is the
   * point — the renderer never holds either version.
   */
  write(text: string): Promise<void> {
    return writeTransport(text);
  },
};
