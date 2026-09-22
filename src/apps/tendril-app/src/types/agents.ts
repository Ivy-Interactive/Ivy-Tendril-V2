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

/* --------------------------------------- the Test Agent dialog, `POST /api/agents/:agent/test` */

/**
 * How a model validation came out — Rust `provider_models::ModelValidationStatus`, V1
 * `Abstractions/AgentTypes.ModelValidationStatus`.
 *
 * `rateLimit` is an error rather than a warning on purpose: the model is valid and reachable, but a
 * fleet started against an exhausted quota produces nothing at all.
 */
export type ModelValidationStatus =
  | "ok"
  | "invalidModel"
  | "authError"
  | "rateLimit"
  | "timeout"
  | "unknown";

export interface ModelValidation {
  status: ModelValidationStatus;
  model: string;
  errorMessage?: string | null;
}

/** Whether the agent's CLI is on the machine — Rust `probe::AgentInstallStatus`. */
export interface AgentInstallStatus {
  isInstalled: boolean;
  version?: string | null;
  binaryPath?: string | null;
  error?: string | null;
}

/** Rust `probe::AuthStatus`. `checkFailed` is "the check itself broke", not "you are signed out". */
export type AuthStatus = "authenticated" | "notAuthenticated" | "checkFailed" | "unknown";

/* ------------------------------------- sign-in hints, `GET /api/agents/hints` */

/**
 * One documented way to carry out a step — Rust `probe::HintCommand`.
 *
 * `then` exists because three of these CLIs have no sign-in *subcommand*: sign-in is a slash command
 * typed inside a running TUI. Flattening it into the shell line would produce `copilot /login`,
 * which is a prompt, not a login — so the two halves stay apart and the renderer says "then type
 * this at the prompt".
 */
export interface HintCommand {
  /** The shell to run. Always a single runnable line. */
  command: string;
  /** What to type at the prompt `command` opens, or absent when the shell line is the whole of it. */
  then?: string;
}

/** One half of a hint — Rust `probe::HintStep`. */
export interface HintStep {
  /** Why the routes below are the ones to take, or — where there are none — what to do instead. */
  summary: string;
  /** Every documented route, best first; the rest are alternatives. Empty for a provider with no CLI. */
  commands: HintCommand[];
  /**
   * A page to open rather than a command to run — the console where a bring-your-own provider's key
   * is created. Separate from `commands` because the two render differently, and a URL shown as
   * shell invites someone to paste it into one.
   */
  url?: string;
}

/**
 * How to install and sign in to one agent — Rust `probe::AgentSignInHint`.
 *
 * The daemon owns these facts and both surfaces render them: the Coding Agent pane's Help section
 * and the Test Agent dialog's authentication row. It used to be a pre-rendered sentence from the
 * probe plus a second hand-written copy in the webview, and the two drifted — three hints ended up
 * naming commands their CLI does not have. Data rather than prose is what stops that recurring.
 */
export interface AgentSignInHint {
  /** The card or agent id this answers for, keyed by card so a BYO card keeps its own console link. */
  agent: string;
  /** What `probe_binary` looks for. Absent for the BYO cards, which are providers rather than CLIs. */
  binary?: string;
  install: HintStep;
  auth: HintStep;
}

export interface AgentAuthResult {
  status: AuthStatus;
  /** Which backend the credential is for: `bedrock`, `vertex`, `anthropic-api`. */
  provider?: string | null;
  /** How it is held: `oauth`, `api-key`, `auth-file`, `environment`. */
  authMethod?: string | null;
  error?: string | null;
  /**
   * How to sign in to this agent, on a probe that found it signed out. Structured rather than the
   * sentence V1 returned: the dialog shows the first route as the thing to do, and the Help section
   * renders the same value in full.
   */
  signInHint?: AgentSignInHint | null;
}

/**
 * One complete Test Agent run.
 *
 * `auth` and `models` are empty when the CLI is missing: the daemon short-circuits there, because an
 * auth probe against a binary that does not exist reports a spawn failure and teaches nobody
 * anything.
 */
export interface TestAgentResult {
  agent: string;
  install: AgentInstallStatus;
  auth?: AgentAuthResult | null;
  models: ModelValidation[];
}

/** The models to validate, in the order the dialog lists them. */
export interface TestAgentRequest {
  models: string[];
}

/* ------------------------------------- the usage strip, `GET /api/agents/:agent/usage` */

/** One provider rate-limit window — Rust `usage::AgentUsageWindow`. */
export interface AgentUsageWindow {
  /** 300 for five hours, 10080 for a week. */
  windowMinutes: number;
  usedPercent: number;
  remainingPercent: number;
  totalTokens?: number | null;
  costUsd?: number | null;
  /** RFC 3339, or absent when the provider does not say. */
  resetsAt?: string | null;
}

/**
 * Every window for one agent, as of one moment.
 *
 * `null` from the route for the four agents whose providers publish no usage at all — Gemini,
 * Copilot, OpenCode and the proxies. That is parity with V1, which has three usage providers and
 * not six, and the pane draws no strip rather than an empty one.
 */
export interface AgentUsageSnapshot {
  agentId: string;
  windows: AgentUsageWindow[];
  /** RFC 3339. The strip says "as of ..." once this is old enough to matter. */
  capturedAt: string;
  /** Which of several same-length limits this came from, e.g. "from Opus weekly limit". */
  note?: string | null;
}
