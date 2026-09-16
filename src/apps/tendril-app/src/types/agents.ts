/** The agent / model / effort catalog served by `GET /api/agents`. */

export interface ModelOption {
  id: string;
  displayName: string;
  /**
   * The effort ladder this model offers under its agent, which is not always the agent's own.
   * V1 declares `SupportedEfforts` on each model row of each provider's catalogue
   * (`ChatApp.GetEffortsForAgentAndModel`), so Copilot on `claude-opus-5` offers Claude's five
   * levels while on `gpt-5.4` it offers Copilot's four. Absent when the agent takes no effort
   * argument at all, in which case `AgentOption.efforts` is empty too.
   */
  efforts?: EffortOption[];
}

export interface EffortOption {
  id: string;
  displayName: string;
}

export interface AgentOption {
  id: string;
  label: string;
  /**
   * The brand mark for this agent, as the `Icons` enum name `BrandIcon` resolves — V1's
   * `AgentBranding.IconFor`. Like the label, the `openaiproxy` row's icon follows the provider its
   * `ANTHROPIC_BASE_URL` points at, which an id-keyed table on the client cannot express. Optional
   * only so a catalogue fixture need not carry one.
   */
  icon?: string;
  models: ModelOption[];
  supportsEffort: boolean;
  /**
   * The ladder for a model that carries none of its own, and for `default`. V1's
   * `IAgentDescriptor.SupportedEfforts`; prefer the selected model's own `efforts` when it has
   * them. Empty when the agent's CLI takes no effort argument, which is what `supportsEffort:
   * false` says.
   */
  efforts: EffortOption[];
}

/**
 * The id every model and effort list starts with. It means "whatever the provider defaults to",
 * so it is never sent on the wire — `AgentLaunchConfig.model` is passed straight to `--model`.
 */
export const DEFAULT_OPTION_ID = "default";
