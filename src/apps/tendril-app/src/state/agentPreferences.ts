/**
 * The model and effort each agent was last used with, remembered per agent so that switching
 * away and back restores that agent's own choice rather than a global default. This is the V2
 * counterpart of the legacy host's `chat-agent-preferences.json`.
 */

export const AGENT_PREFERENCES_STORAGE_KEY = "tendril:chat:agent_preferences";
export const SELECTED_AGENT_STORAGE_KEY = "tendril:chat:selected_agent";

export interface AgentPreference {
  modelId?: string;
  effort?: string;
}

export type AgentPreferences = Record<string, AgentPreference>;

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof window !== "undefined") return window.localStorage;
  } catch {
    // Storage may be restricted; callers fall back to in-memory state
  }
  return null;
}

export function loadStoredAgentPreferences(): AgentPreferences {
  try {
    const raw = getStorage()?.getItem(AGENT_PREFERENCES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as AgentPreferences;
      }
    }
  } catch {
    // Fallback to empty map if storage is restricted or the value is malformed
  }
  return {};
}

export function saveStoredAgentPreferences(data: AgentPreferences): void {
  try {
    const storage = getStorage();
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(AGENT_PREFERENCES_STORAGE_KEY);
      } else {
        storage.setItem(AGENT_PREFERENCES_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

export function loadStoredSelectedAgent(): string | null {
  try {
    return getStorage()?.getItem(SELECTED_AGENT_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveStoredSelectedAgent(agentId: string | null): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    if (agentId) {
      storage.setItem(SELECTED_AGENT_STORAGE_KEY, agentId);
    } else {
      storage.removeItem(SELECTED_AGENT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota or access errors
  }
}
