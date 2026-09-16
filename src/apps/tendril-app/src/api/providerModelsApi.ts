/**
 * Live model discovery for a bring-your-own-LLM endpoint: `POST /api/agents/models`.
 *
 * V1 asks the provider's own `/models` from the app process
 * (`OpenAiProxyModelCatalog.FetchModelsDetailedAsync`, reached from
 * `Apps/Onboarding/CodingAgentStepView.cs:334`). V2 cannot: the API key lives in `config.yaml`'s
 * coding-agent environment, only the daemon may read it, and a provider call from the webview would be
 * cross-origin with the credential in the renderer. So the daemon does the asking and answers with the
 * outcome — never with the key.
 *
 * The transport follows `tableQuery.ts`: Tauri IPC inside the shell, because only the Rust side holds
 * the daemon's bearer secret, and `fetch` outside it, which the dev server proxies. The two are
 * exclusive rather than a fallback chain, for the reason that module gives — a failed `invoke` is a real
 * failure, and retrying it over `fetch` inside the shell would only replace the reason with a confusing
 * one.
 */

import { invoke } from "@tauri-apps/api/core";

import type { ProviderModelsOutcome, ProviderModelsRequest } from "../types/agents";

/** Performs one discovery request. Swapped in tests. */
export type ProviderModelsTransport = (
  request: ProviderModelsRequest,
) => Promise<ProviderModelsOutcome>;

/** Whether the shell is around us. The same test `bridge.ts` and `tableQuery.ts` use. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const PATH = "/api/agents/models";

const httpTransport: ProviderModelsTransport = async (request) => {
  if (isTauri()) {
    return await invoke<ProviderModelsOutcome>("cmd_fetch_provider_models", { request });
  }

  const response = await fetch(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((payload: { error?: string }) => payload.error)
      .catch(() => undefined);
    throw new Error(detail ?? `Request to ${PATH} failed (${response.status})`);
  }
  return (await response.json()) as ProviderModelsOutcome;
};

let transport: ProviderModelsTransport = httpTransport;

export function setProviderModelsTransport(next: ProviderModelsTransport): void {
  transport = next;
}

export function resetProviderModelsTransport(): void {
  transport = httpTransport;
}

/**
 * Asks the daemon what models the configured endpoint serves.
 *
 * Omit `apiKey` to use the one already in `config.yaml` — which is the whole point of the "Fetch
 * models" action: an operator who has saved a key should not have to type it again. Send it only when it
 * has been typed and not yet saved.
 */
export const providerModelsApi = {
  fetch(request: ProviderModelsRequest): Promise<ProviderModelsOutcome> {
    return transport(request);
  },
};
