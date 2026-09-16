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
  /**
   * The model this agent launches with when nobody has chosen one — V1 `ModelInfo.IsDefault`, resolved
   * by `ChatApp.ResolveModel`. A **real id**, always `models[0]`, because V1's sorter pins that row
   * first. There is no synthetic `default` model row: `default` is an effort and a config value for "no
   * opinion", never a model anyone can pick. Optional only so a catalogue fixture need not carry one.
   */
  defaultModel?: string;
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

/* ------------------------------------------------- live discovery, `POST /api/agents/models` */

/**
 * A model an endpoint says it serves, from `provider_models::DiscoveredModel`.
 *
 * Deliberately not an [`AgentOption`] row: it carries no effort ladder, because no provider catalogue
 * declared it. A discovered model is offered for the endpoint it came from and is never merged into an
 * agent's declared list.
 */
export interface DiscoveredModel {
  id: string;
  displayName: string;
}

/** The Deep / Balanced / Quick trio V1's `ModelProfileSelector.SelectDefaults` picks. */
export interface ProfileDefaults {
  deep: string;
  balanced: string;
  quick: string;
}

/**
 * What the daemon made of the endpoint — V1's `CodingAgentStepView` "Continue" branch, as data.
 *
 * The two error arms are two different *fields*: a rejected key is not an endpoint without a model
 * list, and neither is an address that does not answer. Reporting them apart is the point.
 */
export type ProviderModelsOutcome =
  | { status: "models"; models: DiscoveredModel[]; defaults: ProfileDefaults; provider: string }
  | { status: "customNames"; defaults: ProfileDefaults; provider: string; message?: string }
  | { status: "apiKeyError"; message: string }
  | { status: "baseUrlError"; message: string };

/**
 * Both credentials are optional: omitted, the daemon reads them from `config.yaml`, which is how the
 * "Fetch models" action works for a key that is already saved. `apiKey` is an inbound field only — no
 * reply, log line or error message ever carries it back.
 */
export interface ProviderModelsRequest {
  agent?: string;
  baseUrl?: string;
  apiKey?: string;
}
