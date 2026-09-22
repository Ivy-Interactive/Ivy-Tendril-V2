/**
 * The prompt a promptware runs: `GET /api/promptwares/:name/program`.
 *
 * Its own module rather than a method on `bridge.ts` for the reason `configTextApi` is one: the
 * transport is exclusive rather than a fallback chain — Tauri IPC inside the shell, because only the
 * Rust side holds the daemon's bearer secret, and `fetch` outside it, which the dev server proxies.
 * A failed `invoke` inside the shell is a real failure, and retrying it over `fetch` would replace
 * the reason with a confusing one.
 *
 * Read-only. Editing a program is `promptwareOverlay`'s job — a directory the team owns and
 * version-controls — so there is deliberately no write here to put an unversioned layer in front
 * of it.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/tauri";
import { i18n } from "../i18n";

/** Which layer supplied the deployed `Program.md`. */
export type PromptwareLayer = "shipped" | "overlay";

/** `GET /api/promptwares/:name/program`. */
export interface PromptwareProgram {
  name: string;
  /** The deployed `Program.md` verbatim — the bytes the firmware inlines under `## Program`. */
  program: string;
  /** Absent when the deploy manifest predates layering or never recorded this promptware. */
  layer?: PromptwareLayer;
  /** `<Name>/.version`, when either layer stamped one. */
  version?: string;
}

/** Reads one promptware's program. Swapped in tests. */
export type PromptwareProgramTransport = (name: string) => Promise<PromptwareProgram>;

const pathFor = (name: string) => `/api/promptwares/${encodeURIComponent(name)}/program`;

async function readError(response: Response, path: string): Promise<string> {
  const detail = await response
    .json()
    .then((payload: { error?: string }) => payload.error)
    .catch(() => undefined);
  return detail ?? i18n.t("common:errors.requestFailed", { path, status: response.status });
}

const httpReadProgram: PromptwareProgramTransport = async (name) => {
  if (isTauri()) {
    return await invoke<PromptwareProgram>("cmd_get_promptware_program", { name });
  }

  const path = pathFor(name);
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await readError(response, path));
  return (await response.json()) as PromptwareProgram;
};

let readTransport: PromptwareProgramTransport = httpReadProgram;

export function setPromptwareProgramTransport(next: PromptwareProgramTransport): void {
  readTransport = next;
}

export function resetPromptwareProgramTransport(): void {
  readTransport = httpReadProgram;
}

export const promptwaresApi = {
  /**
   * The deployed program for `name`.
   *
   * Rejects when nothing is deployed under that name. "No program" and "no such agent" are the same
   * thing to the pane — there is nothing to show — and a blank panel could not say which happened,
   * so the reason the daemon gives is what the caller renders.
   */
  readProgram(name: string): Promise<PromptwareProgram> {
    return readTransport(name);
  },
};
