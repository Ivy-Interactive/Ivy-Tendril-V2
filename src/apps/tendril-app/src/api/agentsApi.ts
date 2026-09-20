/**
 * The agent catalogue, plus the two probes V1's Coding Agent pane runs against a live agent.
 *
 * `listAgents` is pure `invoke` because the catalogue is static data the daemon composes from
 * config. The other two reach a provider, so they follow `providerModelsApi`'s transport: Tauri IPC
 * inside the shell, because only the Rust side holds the daemon's bearer secret, and `fetch`
 * outside it, which the dev server proxies. The two are exclusive rather than a fallback chain — a
 * failed `invoke` inside the shell is a real failure, and retrying it over `fetch` would only
 * replace the reason with a confusing one.
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  AgentOption,
  AgentUsageSnapshot,
  TestAgentRequest,
  TestAgentResult,
} from "../types/agents";

/** Runs one Test Agent probe. Swapped in tests. */
export type TestAgentTransport = (
  agent: string,
  request: TestAgentRequest,
) => Promise<TestAgentResult>;

/** Reads one agent's usage snapshot. Swapped in tests. */
export type AgentUsageTransport = (agent: string) => Promise<AgentUsageSnapshot | null>;

/** Whether the shell is around us. The same test `bridge.ts` and `providerModelsApi.ts` use. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function readError(response: Response, path: string): Promise<string> {
  const detail = await response
    .json()
    .then((payload: { error?: string }) => payload.error)
    .catch(() => undefined);
  return detail ?? `Request to ${path} failed (${response.status})`;
}

const httpTestAgent: TestAgentTransport = async (agent, request) => {
  if (isTauri()) {
    return await invoke<TestAgentResult>("cmd_test_agent", { agent, request });
  }

  const path = `/api/agents/${encodeURIComponent(agent)}/test`;
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await readError(response, path));
  return (await response.json()) as TestAgentResult;
};

const httpAgentUsage: AgentUsageTransport = async (agent) => {
  if (isTauri()) {
    return await invoke<AgentUsageSnapshot | null>("cmd_get_agent_usage", { agent });
  }

  const path = `/api/agents/${encodeURIComponent(agent)}/usage`;
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await readError(response, path));
  return (await response.json()) as AgentUsageSnapshot | null;
};

let testAgentTransport: TestAgentTransport = httpTestAgent;
let agentUsageTransport: AgentUsageTransport = httpAgentUsage;

export function setAgentProbeTransports(next: {
  testAgent?: TestAgentTransport;
  agentUsage?: AgentUsageTransport;
}): void {
  if (next.testAgent) testAgentTransport = next.testAgent;
  if (next.agentUsage) agentUsageTransport = next.agentUsage;
}

export function resetAgentProbeTransports(): void {
  testAgentTransport = httpTestAgent;
  agentUsageTransport = httpAgentUsage;
}

export const agentsApi = {
  async listAgents(): Promise<AgentOption[]> {
    return await invoke<AgentOption[]>("cmd_list_agents");
  },

  /**
   * Runs install, auth and one validation per model against `agent`.
   *
   * Slow by nature — the daemon gives some agents thirty seconds per model, because the only honest
   * test of whether a provider will serve a model is asking it to.
   */
  testAgent(agent: string, request: TestAgentRequest): Promise<TestAgentResult> {
    return testAgentTransport(agent, request);
  },

  /** This agent's rate-limit windows, or `null` when its provider publishes none. */
  getUsage(agent: string): Promise<AgentUsageSnapshot | null> {
    return agentUsageTransport(agent);
  },
};
