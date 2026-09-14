/** The agent / model / effort catalog served by `GET /api/agents`. */

export interface ModelOption {
  id: string;
  displayName: string;
}

export interface EffortOption {
  id: string;
  displayName: string;
}

export interface AgentOption {
  id: string;
  label: string;
  models: ModelOption[];
  supportsEffort: boolean;
  efforts: EffortOption[];
}

/**
 * The id every model and effort list starts with. It means "whatever the provider defaults to",
 * so it is never sent on the wire — `AgentLaunchConfig.model` is passed straight to `--model`.
 */
export const DEFAULT_OPTION_ID = "default";
