import { invoke } from "@tauri-apps/api/core";
import type { AgentOption } from "../types/agents";

export const agentsApi = {
  async listAgents(): Promise<AgentOption[]> {
    return await invoke<AgentOption[]>("cmd_list_agents");
  },
};
