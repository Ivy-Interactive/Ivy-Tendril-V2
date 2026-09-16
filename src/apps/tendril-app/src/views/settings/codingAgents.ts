import { asRecord, asString, asStringMap } from "./configValues";
import { normalizeAgentName } from "./projectConfig";
import type { TendrilConfig } from "../../types/api";

/**
 * Everything the Coding Agent pane reads out of and writes into `codingAgents`, kept out of the view
 * so the shape it produces can be asserted directly.
 *
 * This is a port of the private statics in `Apps/Settings/CodingAgentSetupView.cs` - the profile
 * getters and `SaveProfiles`/`SetProfile`, the bring-your-own-LLM card resolution, and the four
 * `Save*` credential writers - plus the tier defaults from `agents/resolution.rs`, which is what
 * consumes all of it: `resolve_agent` reads `codingAgents[].profiles[]`, `.arguments` and
 * `.environmentVariables` for every launch.
 */

/** The three tiers `apply_profile` maps by name, in `CodingAgentSetupView`'s order. */
export const PROFILE_TIERS = ["deep", "balanced", "quick"] as const;
export type ProfileTier = (typeof PROFILE_TIERS)[number];

export interface TierValues {
  model: string;
  effort: string;
}
export type Profiles = Record<ProfileTier, TierValues>;

/** `default` is how config spells "leave it to the CLI", so it reads and writes as unset. */
export const DEFAULT_VALUE = "default";

/** The agents `CodingAgentSetupView.Agents` lists, in its order, with its labels and its icons. */
export const CODING_AGENTS: { id: string; label: string; icon: string }[] = [
  { id: "claude", label: "Claude", icon: "ClaudeCode" },
  { id: "copilot", label: "Copilot", icon: "Copilot" },
  { id: "codex", label: "Codex", icon: "OpenAI" },
  { id: "gemini", label: "Gemini", icon: "Gemini" },
  { id: "antigravity", label: "Antigravity", icon: "Antigravity" },
  { id: "opencode", label: "OpenCode", icon: "OpenCode" },
];

/**
 * `CodingAgentSetupView`'s `byoAgents`: three cards that are not agent ids at all but *providers* the
 * `openaiproxy` agent is pointed at, which is why each carries its own default base URL.
 */
export const BYO_CARDS = [
  {
    key: "openaiproxy_card",
    label: "OpenAI",
    icon: "OpenAI",
    defaultBaseUrl: "https://api.openai.com",
  },
  {
    key: "anthropic_card",
    label: "Anthropic",
    icon: "ClaudeCode",
    defaultBaseUrl: "https://api.anthropic.com/v1",
  },
  {
    // V1 has no Berget mark either and uses `Icons.ChevronUp` for this card; `brandIcons` carries the
    // same glyph, so the card reads the same rather than falling back to the terminal default.
    key: "berget_card",
    label: "Berget AI",
    icon: "ChevronUp",
    defaultBaseUrl: "https://api.berget.ai/v1",
  },
] as const;

export type ByoCardKey = (typeof BYO_CARDS)[number]["key"];

export const isByoCard = (card: string): card is ByoCardKey =>
  BYO_CARDS.some((byo) => byo.key === card);

/** `ResolveFinalAgent`: the Ivy proxy is its own agent id, the other three are all `openaiproxy`. */
export function resolveFinalAgent(card: string, baseUrl: string): string {
  const url = (baseUrl || "").toLowerCase();
  const pointsAtIvy = url.includes("llmproxy.ivy.app") || url.includes("ivy.app");
  if ((card === "openaiproxy_card" || card === "ivy") && pointsAtIvy) return "ivy";
  if (isByoCard(card)) return "openaiproxy";
  return card;
}

/** `GetInitialSelectedAgent`: which card a configured `codingAgent` lights up. */
export function initialCard(agent: string, baseUrl: string): string {
  const id = normalizeAgentName(agent || "claude");
  if (id === "ivy") return "openaiproxy_card";
  if (id === "openaiproxy" || id === "proxy") {
    const url = (baseUrl || "").toLowerCase();
    if (url.includes("api.berget.ai")) return "berget_card";
    if (url.includes("api.anthropic.com")) return "anthropic_card";
    return "openaiproxy_card";
  }
  return id;
}

/**
 * `CodingAgentSetupView`'s per-card base-URL correction: switching provider rewrites a URL that
 * belongs to the provider you just left, and leaves a URL that is already this provider's alone.
 */
export function baseUrlForCard(card: string, current: string): string {
  const url = (current || "").toLowerCase();
  if (card === "openaiproxy_card") {
    if (url.includes("api.anthropic.com") || url.includes("api.berget.ai")) {
      return "https://api.openai.com";
    }
    return current;
  }
  if (card === "anthropic_card") {
    if (
      url === "" ||
      url.includes("api.openai.com") ||
      url.includes("api.berget.ai") ||
      url.includes("llmproxy.ivy.app")
    ) {
      return "https://api.anthropic.com/v1";
    }
    return current;
  }
  if (card === "berget_card") {
    if (
      url === "" ||
      url.includes("api.openai.com") ||
      url.includes("api.anthropic.com") ||
      url.includes("llmproxy.ivy.app")
    ) {
      return "https://api.berget.ai/v1";
    }
    return current;
  }
  return current;
}

/** One `codingAgents` entry, with every key it also carried preserved for the write-back. */
export interface AgentEntry {
  name: string;
  arguments: string;
  environmentVariables: Record<string, string>;
  profiles: Record<string, unknown>[];
  rest: Record<string, unknown>;
}

/**
 * Reads `codingAgents` out of the raw config, tolerating both shapes `deserialize_coding_agents`
 * accepts: a sequence of entries, or a mapping of agent name to entry.
 */
export function readAgentEntries(cfg: TendrilConfig | null): AgentEntry[] {
  const raw = cfg?.raw?.codingAgents;
  const entries: [string, Record<string, unknown>][] = Array.isArray(raw)
    ? raw.map((item) => [asString(asRecord(item).name), asRecord(item)])
    : Object.entries(asRecord(raw)).map(([key, value]) => [
        asString(asRecord(value).name) || key,
        asRecord(value),
      ]);

  return entries
    .filter(([name]) => name !== "")
    .map(([name, entry]) => {
      const { name: _n, arguments: _a, environmentVariables: _e, profiles: _p, ...rest } = entry;
      return {
        name,
        arguments: asString(entry.arguments),
        environmentVariables: asStringMap(entry.environmentVariables),
        profiles: Array.isArray(entry.profiles) ? entry.profiles.map(asRecord) : [],
        rest,
      };
    });
}

export const findEntry = (entries: AgentEntry[], agentId: string): AgentEntry | undefined =>
  entries.find((entry) => normalizeAgentName(entry.name) === normalizeAgentName(agentId));

/** `GetProfileModel` / `GetProfileEffort`: an unset value reads back as the literal `default`. */
export function profileValue(
  entry: AgentEntry | undefined,
  tier: ProfileTier,
  field: "model" | "effort",
): string {
  const profile = entry?.profiles.find((p) => asString(p.name).toLowerCase() === tier);
  const value = asString(profile?.[field]);
  if (value.trim() === "") return DEFAULT_VALUE;
  return field === "effort" ? value.toLowerCase() : value;
}

export const readProfiles = (entry: AgentEntry | undefined): Profiles =>
  Object.fromEntries(
    PROFILE_TIERS.map((tier) => [
      tier,
      { model: profileValue(entry, tier, "model"), effort: profileValue(entry, tier, "effort") },
    ]),
  ) as Profiles;

/** Serialises an entry back, keys and order as they arrived. */
const serialize = (entry: AgentEntry): Record<string, unknown> => ({
  ...entry.rest,
  name: entry.name,
  arguments: entry.arguments,
  environmentVariables: entry.environmentVariables,
  profiles: entry.profiles,
});

const withEntry = (entries: AgentEntry[], agentId: string): AgentEntry[] => {
  const id = normalizeAgentName(agentId);
  if (findEntry(entries, id)) return entries;
  return [
    ...entries,
    { name: id, arguments: "", environmentVariables: {}, profiles: [], rest: {} },
  ];
};

/** `SetProfile`: upsert by name, with `default`/blank normalised to the empty string `is_set` reads. */
function setProfiles(entry: AgentEntry, profiles: Profiles): Record<string, unknown>[] {
  const next = entry.profiles.map((p) => ({ ...p }));
  for (const tier of PROFILE_TIERS) {
    const model = profiles[tier].model.trim();
    const effort = profiles[tier].effort.trim();
    const values = {
      model: model.toLowerCase() === DEFAULT_VALUE ? "" : model,
      effort: effort.toLowerCase() === DEFAULT_VALUE ? "" : effort.toLowerCase(),
    };
    const index = next.findIndex((p) => asString(p.name).toLowerCase() === tier);
    if (index >= 0) next[index] = { ...next[index], ...values };
    else next.push({ name: tier, ...values });
  }
  return next;
}

/**
 * The `codingAgents` array to write: `agentId`'s profiles, arguments and environment set, and every
 * other agent (and every unmodeled key) left exactly as it was.
 *
 * The whole array has to be sent because `merge_config_value` replaces sequences rather than merging
 * them, which is also why an omitted agent would be a deletion.
 */
export function withAgentSettings(
  entries: AgentEntry[],
  agentId: string,
  values: {
    profiles: Profiles;
    arguments: string;
    environmentVariables: Record<string, string>;
  },
): Record<string, unknown>[] {
  const id = normalizeAgentName(agentId);
  return withEntry(entries, id).map((entry) => {
    if (normalizeAgentName(entry.name) !== id) return serialize(entry);
    return {
      ...serialize(entry),
      arguments: values.arguments,
      environmentVariables: values.environmentVariables,
      profiles: setProfiles(entry, values.profiles),
    };
  });
}

/* ------------------------------------------------------------------ credentials */

const ANTHROPIC_KEY = "ANTHROPIC_API_KEY";
const OPENAI_KEY = "OPENAI_API_KEY";
const IVY_KEY = "IVY_API_KEY";
const ANTHROPIC_URL = "ANTHROPIC_BASE_URL";
const OPENAI_URL = "OPENAI_BASE_URL";
const IVY_URL = "IVY_BASE_URL";

const firstOf = (env: Record<string, string>, keys: string[]): string => {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== "") return value;
  }
  return "";
};

/** `GetIvyApiKeyFromConfig` / `GetOpenAiProxyApiKeyFromConfig`. */
export function readApiKey(entries: AgentEntry[], finalAgent: string): string {
  const env = findEntry(entries, finalAgent)?.environmentVariables ?? {};
  return finalAgent === "ivy"
    ? (env[ANTHROPIC_KEY] ?? "")
    : firstOf(env, [ANTHROPIC_KEY, OPENAI_KEY]);
}

/** `GetIvyBaseUrlFromConfig` / `GetOpenAiProxyBaseUrlFromConfig`. */
export function readBaseUrl(entries: AgentEntry[], finalAgent: string): string {
  const env = findEntry(entries, finalAgent)?.environmentVariables ?? {};
  return finalAgent === "ivy"
    ? firstOf(env, [ANTHROPIC_URL, OPENAI_URL, IVY_URL])
    : firstOf(env, [ANTHROPIC_URL, OPENAI_URL]);
}

/** `GetInitialByoUrl`: the configured URL, or the provider's own default. */
export function initialBaseUrl(entries: AgentEntry[], agent: string): string {
  const id = normalizeAgentName(agent || "claude");
  if (id === "ivy") return readBaseUrl(entries, "ivy") || "https://llmproxy.ivy.app";
  if (id === "openaiproxy" || id === "proxy") {
    return readBaseUrl(entries, "openaiproxy") || "https://api.openai.com";
  }
  return "https://api.openai.com";
}

/**
 * `SaveIvyBaseUrl` / `SaveOpenAiProxyBaseUrl`'s split: the Anthropic SDK wants the bare host and the
 * OpenAI one wants it with `/v1`, so one field becomes two variables.
 */
function baseUrlVariables(url: string): { anthropic: string; openai: string; bare: string } {
  const trimmed = url.trim().replace(/\/+$/, "");
  const hasV1 = trimmed.toLowerCase().endsWith("/v1");
  return {
    anthropic: hasV1 ? trimmed.slice(0, -3) : trimmed,
    openai: hasV1 ? trimmed : `${trimmed}/v1`,
    bare: trimmed,
  };
}

/**
 * The environment one BYO provider's credentials become, applied over whatever the entry already
 * carried. Mirrors the four `Save*` writers: an empty value **removes** the variables rather than
 * writing an empty one, because an empty `OPENAI_API_KEY` in the launch environment shadows the key
 * the CLI would otherwise find for itself.
 */
export function byoEnvironment(
  existing: Record<string, string>,
  finalAgent: string,
  baseUrl: string,
  apiKey: string,
): Record<string, string> {
  const env = { ...existing };
  const isIvy = finalAgent === "ivy";
  const keyNames = isIvy ? [ANTHROPIC_KEY, OPENAI_KEY, IVY_KEY] : [ANTHROPIC_KEY, OPENAI_KEY];
  const urlNames = isIvy ? [ANTHROPIC_URL, OPENAI_URL, IVY_URL] : [ANTHROPIC_URL, OPENAI_URL];

  if (apiKey === "") for (const name of keyNames) delete env[name];
  else for (const name of keyNames) env[name] = apiKey;

  if (baseUrl.trim() === "") {
    for (const name of urlNames) delete env[name];
  } else {
    const parts = baseUrlVariables(baseUrl);
    env[ANTHROPIC_URL] = parts.anthropic;
    env[OPENAI_URL] = parts.openai;
    if (isIvy) env[IVY_URL] = parts.bare;
  }

  return env;
}

/**
 * `CodingAgentSetupView`'s Save for the BYO cards, including its two provider corrections: Berget
 * always ends up on `api.berget.ai`, and a blank Anthropic URL becomes the Anthropic default.
 *
 * The Ivy card is the odd one out - V1 writes the credentials to **both** the `ivy` and the
 * `openaiproxy` entries, because the model catalogue is fetched as `ivy` while a launch may resolve
 * either id.
 */
export function withByoCredentials(
  serialized: Record<string, unknown>[],
  card: string,
  baseUrl: string,
  apiKey: string,
): Record<string, unknown>[] {
  const finalAgent = resolveFinalAgent(card, baseUrl);
  let url = baseUrl;
  if (card === "berget_card" && !url.toLowerCase().includes("api.berget.ai")) {
    url = "https://api.berget.ai/v1";
  }
  if (card === "anthropic_card" && url.trim() === "") url = "https://api.anthropic.com/v1";

  const targets = finalAgent === "ivy" ? ["ivy", "openaiproxy"] : [finalAgent];
  let out = serialized;
  for (const target of targets) {
    const id = normalizeAgentName(target);
    const known = out.some((entry) => normalizeAgentName(asString(entry.name)) === id);
    const list = known
      ? out
      : [...out, { name: id, arguments: "", environmentVariables: {}, profiles: [] }];
    out = list.map((entry) => {
      if (normalizeAgentName(asString(entry.name)) !== id) return entry;
      return {
        ...entry,
        environmentVariables: byoEnvironment(
          asStringMap(entry.environmentVariables),
          id,
          url,
          apiKey,
        ),
      };
    });
  }
  return out;
}

/* ------------------------------------------------------------------ tier defaults */

/** `agent_capabilities`: Gemini's CLI has no effort argument, so an effort field there is inert. */
export const supportsEffort = (agent: string): boolean => normalizeAgentName(agent) !== "gemini";

const tiers = (deep: TierValues, balanced: TierValues, quick: TierValues): Profiles => ({
  deep,
  balanced,
  quick,
});

const IVY_TIERS = tiers(
  { model: "claude-opus-5", effort: "max" },
  { model: "gemini-3.7-flash", effort: "medium" },
  { model: "gemini-3.7-flash", effort: "low" },
);

/** `openai_proxy_tiers`: the proxy has no model line of its own, so its defaults follow its URL. */
export function openAiProxyTiers(baseUrl: string): Profiles {
  const base = (baseUrl || "").toLowerCase();
  if (base.includes("llmproxy.ivy.app")) return IVY_TIERS;
  if (base.includes("api.anthropic.com")) {
    return tiers(
      { model: "claude-opus-5", effort: "max" },
      { model: "claude-sonnet-5", effort: "high" },
      { model: "claude-haiku-4-5", effort: "low" },
    );
  }
  if (
    base.includes("generativelanguage.googleapis.com") ||
    base.includes("gemini") ||
    base.includes("google")
  ) {
    return tiers(
      { model: "gemini-3.7-flash", effort: "high" },
      { model: "gemini-3.7-flash", effort: "medium" },
      { model: "gemini-3.7-flash", effort: "medium" },
    );
  }
  if (base.includes("api.berget.ai")) {
    return tiers(
      { model: "moonshotai/Kimi-K3", effort: "max" },
      { model: "moonshotai/Kimi-K3", effort: "high" },
      { model: "moonshotai/Kimi-K3", effort: "low" },
    );
  }
  return tiers(
    { model: "gpt-5.6-sol", effort: "high" },
    { model: "gpt-5.6-terra", effort: "medium" },
    { model: "gpt-5.6-luna", effort: "low" },
  );
}

/**
 * `resolution.rs`'s `default_profiles`, so an empty field can show what the tier falls back to rather
 * than looking like "nothing will be passed".
 */
export function tierDefaults(agent: string, baseUrl = ""): Profiles {
  switch (normalizeAgentName(agent)) {
    case "codex":
      return tiers(
        { model: "gpt-5.6-sol", effort: "high" },
        { model: "gpt-5.6-terra", effort: "medium" },
        { model: "gpt-5.6-luna", effort: "low" },
      );
    case "gemini":
      return tiers(
        { model: "gemini-3.7-flash", effort: "" },
        { model: "gemini-3.7-flash", effort: "" },
        { model: "gemini-3.7-flash", effort: "" },
      );
    case "opencode":
      return tiers(
        { model: "default", effort: "high" },
        { model: "default", effort: "medium" },
        { model: "default", effort: "low" },
      );
    case "copilot":
      return tiers(
        { model: "", effort: "high" },
        { model: "", effort: "medium" },
        { model: "", effort: "low" },
      );
    case "antigravity":
    case "agy":
      return tiers(
        { model: "gemini-3.7-flash", effort: "medium" },
        { model: "gemini-3.7-flash", effort: "medium" },
        { model: "gemini-3.7-flash", effort: "medium" },
      );
    case "ivy":
      return IVY_TIERS;
    case "openaiproxy":
    case "proxy":
      return openAiProxyTiers(baseUrl);
    default:
      // claude, and any id we do not know: Claude is the default provider.
      return tiers(
        { model: "opus", effort: "max" },
        { model: "sonnet", effort: "high" },
        { model: "haiku", effort: "low" },
      );
  }
}

/**
 * Which catalog entry supplies a card's models and efforts.
 *
 * A bundled agent uses its own entry. A BYO card is not an agent id at all, and the entry
 * `GET /api/agents` serves for `openaiproxy` is resolved from the `ANTHROPIC_BASE_URL` **on disk** -
 * so while the operator is typing a new URL, or has picked a card whose provider the saved config
 * does not point at, that entry is the wrong provider's list. Picking the Anthropic card and being
 * shown the models of whatever the proxy was last saved against is exactly how a Claude selection
 * came to offer Gemini rows.
 *
 * So the card and the URL in front of the operator pick the catalogue, by V1's own table:
 * `OpenAiProxyModelCatalog.GetModelsForBaseUrl` returns the Claude catalogue for `api.anthropic.com`,
 * the Codex one for `api.openai.com` or no URL at all, the Gemini one for Google's endpoint, the Ivy
 * splice for `ivy.app`, and OpenCode's list plus Qwen for Berget - and every one of those is a
 * catalogue this build already serves under its own agent id.
 *
 * Only an unrecognised custom URL falls through to the daemon's own `openaiproxy` row, which is V1's
 * declared union for that case. V1 asks the provider's `/models` endpoint first; this build has no
 * client for that, so the declared list is all there is.
 */
export function catalogAgentFor(
  finalAgent: string,
  available: string[] = [],
  baseUrl = "",
): string {
  const id = normalizeAgentName(finalAgent);
  const first = (...candidates: string[]): string =>
    candidates.find((candidate) => available.includes(candidate)) ?? candidates[0];

  if (id !== "openaiproxy" && id !== "proxy" && id !== "ivy") return id;

  const url = (baseUrl || "").toLowerCase();
  if (id === "ivy" || url.includes("ivy.app")) return first("ivy", "opencode");
  if (url.includes("api.berget.ai")) return first("opencode");
  if (url.includes("api.anthropic.com")) return first("claude");
  if (
    url.includes("generativelanguage.googleapis.com") ||
    url.includes("gemini") ||
    url.includes("google")
  ) {
    return first("gemini");
  }
  if (url.includes("api.openai.com") || url.trim() === "") return first("codex");
  return first("openaiproxy", "opencode");
}
