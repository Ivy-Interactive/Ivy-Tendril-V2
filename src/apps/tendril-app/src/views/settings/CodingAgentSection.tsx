import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BrandIcon, CodeBlock } from "@ivy-interactive/components/tendril";
import { Button, Callout, Input, Label, Switch } from "@ivy-interactive/components/ui";
import { Check, ExternalLink } from "lucide-react";
import { agentsApi } from "../../api/agentsApi";
import { providerModelsApi } from "../../api/providerModelsApi";
import { Trans, useTranslation, type TFunction } from "../../i18n";
import { notificationsStore } from "../../state/notificationsStore";
import { describeBridgeError, type TendrilConfig } from "../../types/api";
import {
  DEFAULT_OPTION_ID,
  type AgentOption,
  type AgentSignInHint,
  type DiscoveredModel,
  type HintStep,
  type ProfileDefaults,
} from "../../types/agents";
import { formatEnvLines, parseEnvLines } from "./configValues";
import { normalizeAgentName } from "./projectConfig";
import { AgentTestDialog, type TestModelEntry } from "./AgentTestDialog";
import { AgentUsageStrip } from "./AgentUsageStrip";
import { cardLabel, helpForCard, useAgentHints } from "./agentHelp";
import {
  LinesField,
  NativeSelectField,
  SaveError,
  SettingsSection,
  SubSection,
  TextField,
} from "./fields";
import {
  BYO_CARDS,
  CODING_AGENTS,
  DEFAULT_VALUE,
  PROFILE_TIERS,
  catalogAgentFor,
  findEntry,
  initialBaseUrl,
  initialCard,
  isByoCard,
  readAgentEntries,
  readApiKey,
  readBaseUrl,
  readProfiles,
  resolveFinalAgent,
  baseUrlForCard,
  supportsEffort,
  tierDefaults,
  withAgentSettings,
  withByoCredentials,
  type Profiles,
  type ProfileTier,
} from "./codingAgents";

/**
 * `Apps/Settings/CodingAgentSetupView.cs`.
 *
 * V1's pane, in its order: the grid of bundled agents, the "Bring your own LLM" grid, that provider's
 * base URL and key, and the Deep / Balanced / Quick profile models with an effort beside each - then
 * one Save that writes `codingAgent`, the profiles and the credentials together. `resolve_agent` reads
 * every one of those keys back for each launch, which is why they are written in the shapes
 * `codingAgents.ts` produces rather than as anything more convenient.
 *
 * Above the profiles sits the usage strip - this agent's rate-limit windows - and below Save is Test
 * Agent, which runs install, auth and one prompt per configured model. Both are V1 blocks; both read
 * routes that V2 grew for them, since neither answer can be computed in a webview.
 */

/** `EffortLevels.Claude`, V1's fallback when neither the model nor the descriptor names any. */
const FALLBACK_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/**
 * `.Label("Deep")` / `.Label("Balanced")` / `.Label("Quick")`, the labels V1 gives the three rows.
 * The tier id is the config value and stays as it is; only the label is translated.
 */
const tierLabel = (t: TFunction<"settingsAgents">, tier: ProfileTier): string =>
  t(`profiles.tiers.${tier}`);

/**
 * The effort ids this pane has a label for. The id is the config value and is never translated; any
 * other id - a level the daemon added since - is shown as it is.
 */
const EFFORT_IDS = ["default", "low", "medium", "high", "xhigh", "max"] as const;
type EffortId = (typeof EFFORT_IDS)[number];
const isEffortId = (id: string): id is EffortId => (EFFORT_IDS as readonly string[]).includes(id);

const effortLabel = (t: TFunction<"settingsAgents">, id: string): string =>
  isEffortId(id) ? t(`profiles.efforts.${id}`) : id;

/** `ConfigCommand.ValidateCodingAgent`'s refusal, with the same sorted valid-agent list. */
const unknownAgentMessage = (t: TFunction<"settingsAgents">, value: string): string =>
  t("section.unknownAgent", {
    value,
    agents: CODING_AGENTS.map((a) => a.id)
      .slice()
      .sort()
      .join(", "),
  });

/**
 * What the discovery call last said about the endpoint, kept as data and worded at render time so
 * the note follows the language.
 */
type DiscoveryNote =
  | { kind: "found"; count: number }
  | { kind: "customNames" }
  | { kind: "unreachable"; error: string };

const discoveryNoteText = (t: TFunction<"settingsAgents">, note: DiscoveryNote): string => {
  switch (note.kind) {
    case "found":
      return t("byo.discovery.found", { count: note.count });
    case "customNames":
      return t("byo.discovery.customNames");
    case "unreachable":
      return t("byo.discovery.unreachable", { error: note.error });
  }
};

/**
 * One card in either grid: `new Card(logo | label | Spacer | check).OnClick(...)`.
 *
 * `p-6` and `text-base` are what that `new Card` resolves to rather than arbitrary choices. Ivy's
 * `CardWidget` at its default medium density pads a header-less card with `p-6` and applies no font
 * override, so V1 draws an 82px card around its 32px logo. V2 had `p-3` and `text-sm`, which is the
 * 56px card the operator is looking at - the same content in a box a third shorter.
 */
const AgentCard: React.FC<{
  id: string;
  label: string;
  icon: string;
  selected: boolean;
  onClick: () => void;
}> = ({ id, label, icon, selected, onClick }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    data-testid={`coding-agent-${id}`}
    /*
     * `cursor-pointer` and the focus ring are stated because a raw `<button>` gets neither: Tailwind
     * v4 dropped v3's `button { cursor: pointer }` preflight rule, and `Button`'s own variant string
     * is what re-adds it for every card built on the shared component. This card is not, so it had
     * the same "nothing suggests this is clickable" problem as the sidebar rows.
     *
     * The idle hover also moves from `bg-muted/50` to `bg-secondary/60`. `--muted` is `#f8f8f8` on
     * this card's `#ffffff` surface -- 1.06:1 before the 50% alpha halves it again -- so the old
     * hover was invisible in light mode. `bg-secondary/60` matches what the sidebar rows now use.
     */
    className={`flex cursor-pointer items-center gap-3 rounded-box border p-6 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
      selected ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-secondary/60"
    }`}
  >
    <BrandIcon name={icon} size={32} className="shrink-0 text-foreground" />
    <span className="min-w-0 truncate text-base font-medium text-foreground">{label}</span>
    {selected && <Check className="ml-auto size-5 shrink-0 text-primary" aria-hidden="true" />}
  </button>
);

/**
 * One numbered step of the Help block: what to do, and the shell or the link that does it.
 *
 * `CodeBlock` is passed no `language`, which is deliberate rather than an omission. With one it
 * mounts the lazy `react-syntax-highlighter` and pulls the `vendor-syntax` chunk - 600 kB of
 * refractor language packs to colour a `brew install` - and without one it renders the same geometry
 * through `PlainPre` and keeps the copy button, which is the only part of it this block needs.
 *
 * Routes after the first are alternatives, and are labelled as such rather than folded into one
 * block: the daemon sends them as separate commands precisely so the copy button copies something
 * runnable. `then` is a slash command typed at the prompt the shell line opens - three of these CLIs
 * have no sign-in subcommand at all - so it is shown beside the block, never inside it, because
 * `copilot /login` is a prompt rather than a login.
 */
const HelpStep: React.FC<{ title: string; step: HintStep; testId: string }> = ({
  title,
  step,
  testId,
}) => {
  const { t } = useTranslation("settingsAgents");
  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="text-xs font-medium text-foreground">{title}</p>
      {/* The daemon's own sentence (`probe.rs`), shown as it is sent. */}
      <p className="text-xs text-foreground">{step.summary}</p>
      {step.commands.map((route, index) => (
        <div key={route.command} className="space-y-1">
          {index > 0 && <p className="text-xs text-muted-foreground">{t("help.or")}</p>}
          <CodeBlock content={route.command} />
          {route.then && (
            <p className="text-xs text-muted-foreground" data-testid={`${testId}-then`}>
              <Trans
                ns="settingsAgents"
                i18nKey="help.then"
                values={{ command: route.then }}
                components={{ code: <code className="font-mono" /> }}
              />
            </p>
          )}
        </div>
      ))}
      {/* `openUrl` rather than an `<a>`: this is a webview, and a target-less navigation replaces the
        app with the vendor's console. Same call `SecurityTunnelingSection` and `InboxView` make. */}
      {step.url && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`${testId}-link`}
          onClick={() => void openUrl(step.url!)}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {step.url}
        </Button>
      )}
    </div>
  );
};

/**
 * Install and sign-in instructions for the card in front of the operator.
 *
 * It sits below Extra Arguments rather than above the grid because it answers a question asked after
 * a card is picked, and because everything above it is settings this pane writes while none of this
 * is. The content comes from the daemon (`GET /api/agents/hints`) rather than from a table in the
 * webview: `probe.rs` already owns these facts for the sign-in hint a failed auth check returns, and
 * a second copy here is what drifted - it told people to run `claude auth login` while the probe
 * told them `claude login`, which is not a command the CLI has.
 *
 * Renders nothing while the hints are in flight, for a daemon that did not answer, or for a card the
 * daemon has no hint for. The last is only reachable through a `codingAgent` value that is not a
 * card at all, which the `unknownAgent` callout at the top of the pane already names.
 */
const AgentHelpBlock: React.FC<{ card: string; hints: Record<string, AgentSignInHint> | null }> = ({
  card,
  hints,
}) => {
  const { t } = useTranslation("settingsAgents");
  const help = helpForCard(hints, card);
  if (!help) return null;

  return (
    <SubSection
      title={t("help.title")}
      hint={t("help.hint", { agent: cardLabel(card) })}
      testId="agent-help-block"
    >
      <div className="space-y-4" data-testid={`agent-help-${card}`}>
        <HelpStep title={t("help.install")} step={help.install} testId="agent-help-install" />
        <HelpStep
          title={help.binary ? t("help.authenticate") : t("help.apiKey")}
          step={help.auth}
          testId="agent-help-auth"
        />
        {/* The one fact an operator cannot get from the vendor's own docs: which binary *this* app
            spawns. `probe_binary` resolves `cursor` to `cursor-agent` and `antigravity` to `agy`, so
            following Cursor's or Google's instructions alone can leave a working CLI that Tendril
            still reports as missing. */}
        {help.binary && (
          <p className="text-xs text-muted-foreground" data-testid="agent-help-binary">
            <Trans
              ns="settingsAgents"
              i18nKey="help.binary"
              values={{ binary: help.binary }}
              components={{ code: <code className="font-mono" /> }}
            />
          </p>
        )}
      </div>
    </SubSection>
  );
};

export const CodingAgentSection: React.FC<{
  config: TendrilConfig | null;
  /** `config.yaml`'s `codingAgent`, i.e. what is on disk rather than what is selected. */
  savedAgent: string;
  /** Writes one key and re-reads the config (`SettingsView`'s `saveRawKey`). */
  onSaveRaw: (key: string, value: unknown) => Promise<void>;
}> = ({ config, savedAgent, onSaveRaw }) => {
  const { t } = useTranslation("settingsAgents");
  const entries = React.useMemo(() => readAgentEntries(config), [config]);

  // `GetInitialSelectedAgent` / `GetInitialByoUrl` / `GetInitialApiKey`: which card is lit, and the
  // credentials behind it, are all derived from the one configured agent id.
  //
  // Derived until the operator picks, rather than seeded into state, because V1 builds this view with
  // the config already loaded and V2 does not: the config arrives one render late, and a `useState`
  // initialiser would then have latched onto the `claude` placeholder for good.
  const [chosenCard, setChosenCard] = React.useState<string | null>(null);
  const [typedBaseUrl, setTypedBaseUrl] = React.useState<string | null>(null);
  const [typedApiKey, setTypedApiKey] = React.useState<string | null>(null);
  const [customNames, setCustomNames] = React.useState(false);
  const [agents, setAgents] = React.useState<AgentOption[]>([]);
  const [isSaving, setIsSaving] = React.useState(false);
  /** The bridge's detail for a failed save, worded at render time. */
  const [error, setError] = React.useState<string | null>(null);
  const [isTestOpen, setIsTestOpen] = React.useState(false);

  // The Help block's content, fetched once from the daemon rather than kept as a second copy here.
  const agentHints = useAgentHints();

  // Live discovery (`POST /api/agents/models`). `discovered` is per endpoint rather than global: it is
  // what *this* URL answered, and switching cards discards it.
  const [discovered, setDiscovered] = React.useState<DiscoveredModel[] | null>(null);
  const [discoveryNote, setDiscoveryNote] = React.useState<DiscoveryNote | null>(null);
  const [apiKeyError, setApiKeyError] = React.useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = React.useState<string | null>(null);
  const [isFetchingModels, setIsFetchingModels] = React.useState(false);
  /**
   * Which (agent, URL) pairs have already been tried unprompted. V1 fetches on an explicit Continue;
   * this pane also tries once when it opens onto a card whose key is already saved, and this is what
   * keeps "once" true — a keystroke in the key or URL field must not fire a request.
   */
  const attempted = React.useRef<Set<string>>(new Set());

  const configuredBaseUrl = initialBaseUrl(entries, savedAgent);
  const baseUrl = typedBaseUrl ?? configuredBaseUrl;
  const card = chosenCard ?? initialCard(savedAgent, configuredBaseUrl);

  const finalAgent = resolveFinalAgent(card, baseUrl);
  const savedEntry = findEntry(entries, finalAgent);
  const savedProfiles = React.useMemo(() => readProfiles(savedEntry), [savedEntry]);
  const savedArguments = savedEntry?.arguments ?? "";
  const savedEnv = React.useMemo(
    () => formatEnvLines(savedEntry?.environmentVariables ?? {}),
    [savedEntry],
  );
  const savedApiKey = readApiKey(entries, finalAgent);
  const savedBaseUrl = readBaseUrl(entries, finalAgent);

  const apiKey = typedApiKey ?? savedApiKey;

  const [profiles, setProfiles] = React.useState<Profiles>(savedProfiles);
  const [agentArguments, setAgentArguments] = React.useState(savedArguments);
  const [agentEnv, setAgentEnv] = React.useState(savedEnv);

  // `CodingAgentSetupView` re-seeds every field from config when the selected card changes, so
  // switching cards shows that agent's profiles rather than the previous agent's.
  React.useEffect(() => {
    setProfiles(savedProfiles);
    setAgentArguments(savedArguments);
    setAgentEnv(savedEnv);
  }, [savedProfiles, savedArguments, savedEnv]);

  /**
   * The model and effort catalogue (`GET /api/agents`), V1's `runner.GetModelCatalog(agentId)`. A
   * failed fetch leaves it empty, which falls back to typing a model id - see `isCustomMode`.
   */
  React.useEffect(() => {
    let cancelled = false;
    agentsApi
      .listAgents()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch(() => {
        // Offline daemon: the fields stay editable as free text.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogAgent = agents.find(
    (agent) =>
      agent.id ===
      catalogAgentFor(
        finalAgent,
        agents.map((a) => a.id),
        baseUrl,
      ),
  );
  const catalogModels = catalogAgent?.models ?? [];

  /**
   * What the selects offer: the endpoint's own list when it gave one, else the declared catalogue.
   *
   * That order is V1's `OpenAiProxyModelCatalog.GetModelsAsync` — dynamic when the fetch returned
   * anything, static otherwise. Discovered rows are used here and nowhere else: they are not merged into
   * `catalog.rs`'s declared lists, so no agent starts offering a model because some endpoint mentioned
   * it. The consequence is that a discovered row has no effort ladder of its own and falls back to the
   * agent's, which is what `effortOptionsFor` already does for an id it does not recognise.
   */
  const modelOptions =
    discovered && discovered.length > 0
      ? discovered.map((model) => ({ value: model.id, label: model.displayName }))
      : catalogModels.map((model) => ({ value: model.id, label: model.displayName }));

  /**
   * What a tier shows when nothing has been chosen for it.
   *
   * `config.yaml` spells "no opinion" as an absent value, which `readProfiles` reads back as the
   * sentinel `default` - and a select cannot honestly render that, which is the whole complaint. V1 does
   * not try: `ResolveAgentModelsAndEffort` (`CodingAgentSetupView.cs:521-545`) replaces the sentinel with
   * a concrete model before the select ever sees it, choosing it with `ModelProfileSelector`. So does
   * this, from the three answers available in order of authority: what the endpoint's own list resolved
   * to, the tier table `resolution.rs` actually falls back to, and the agent's `IsDefault` model.
   *
   * Displayed, not stored. The tier stays unset in `profiles` until the operator picks something, because
   * writing a concrete id would flip `apply_profile` from "no opinion" to a pinned model - and an unset
   * tier is a different thing from a bogus `default` *model*, which is what was removed.
   */
  const resolvedTierModel = (tier: ProfileTier): string => {
    const offers = (id: string) => id !== "" && modelOptions.some((option) => option.value === id);
    const fromTierTable = tierDefaults(finalAgent, baseUrl)[tier].model;
    if (offers(fromTierTable)) return fromTierTable;
    if (catalogAgent?.defaultModel && offers(catalogAgent.defaultModel)) {
      return catalogAgent.defaultModel;
    }
    return modelOptions[0]?.value ?? "";
  };

  /** `default`, or an absent value, is "unset" - never a model. */
  const isTierUnset = (value: string) => value.trim() === "" || value === DEFAULT_VALUE;

  const shownTierModel = (tier: ProfileTier): string =>
    isTierUnset(profiles[tier].model) ? resolvedTierModel(tier) : profiles[tier].model;

  /**
   * `GetEffortOptions(modelId)`: the ladder belongs to the **model** first and to the agent second,
   * because V1 declares `SupportedEfforts` on every catalogue row - Copilot on `claude-opus-5` offers
   * Claude's five levels and on `gpt-5.4` its own four. Each profile's effort select is therefore
   * built from the model chosen beside it, not from the agent. V1's last resort when neither names
   * one is `EffortLevels.Claude`, which is also what an unreachable daemon gets here.
   */
  const effortOptionsFor = (modelId: string): { value: string; label: string }[] => {
    const model = catalogModels.find((candidate) => candidate.id === modelId);
    const ladder =
      model?.efforts && model.efforts.length > 0
        ? model.efforts.map((effort) => effort.id)
        : (catalogAgent?.efforts ?? []).length > 0
          ? catalogAgent!.efforts.map((effort) => effort.id)
          : catalogAgent
            ? []
            : [DEFAULT_OPTION_ID, ...FALLBACK_EFFORTS];
    return ladder.map((id) => ({ value: id, label: effortLabel(t, id) }));
  };

  const isByo = isByoCard(card);
  /**
   * V1 offers free text only for a BYO provider, and only once its `/models` call has come back. This
   * build has no per-provider `/models` client, so the rule is widened by one case: an empty catalogue
   * also means free text, because a model field that cannot be edited while the daemon is unreachable
   * is worse than one that accepts an id V2 has not heard of.
   */
  const isCustomMode = modelOptions.length === 0 || (isByo && customNames);
  /**
   * `supportsEffort` is the descriptor's `EffortControl` capability, which is a property of the agent
   * rather than of the model beside it: V1 keeps or drops the whole effort column on it, and only then
   * asks each row's model what its levels are.
   */
  const effortEnabled = catalogAgent
    ? catalogAgent.supportsEffort
    : supportsEffort(finalAgent) && effortOptionsFor(DEFAULT_OPTION_ID).length > 0;
  const defaults = tierDefaults(finalAgent, baseUrl);

  /**
   * `getModels()` in `CodingAgentSetupView.cs:415-441`: what Test Agent validates.
   *
   * The three tiers in order, deduplicated - two tiers on one model is one prompt, not two, and the
   * dialog charges a real request per row. An unset tier contributes a single row labelled "Default"
   * however many tiers are unset, deduplicated on the literal key `default` rather than on the model
   * id, because "whatever this agent defaults to" is one thing regardless of what it resolves to.
   * Everything else dedupes case-insensitively and shows the catalogue's display name.
   *
   * Deliberately the *stored* value, not `shownTierModel`: a tier the operator has not touched must
   * be tested as unset, which is what a launch would do with it. Testing the resolved model instead
   * would validate a model the agent might never be asked for.
   */
  const testModels: TestModelEntry[] = React.useMemo(() => {
    const entries: TestModelEntry[] = [];
    const seen = new Set<string>();
    for (const tier of PROFILE_TIERS) {
      const model = profiles[tier].model;
      if (isTierUnset(model)) {
        if (!seen.has("default")) {
          seen.add("default");
          // Named by the dialog at render time, so the row follows a language change.
          entries.push({ id: "", displayName: "" });
        }
        continue;
      }
      const key = model.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const known = modelOptions.find((option) => option.value.toLowerCase() === key);
      entries.push({ id: model, displayName: known?.label ?? model });
    }
    return entries;
    // `modelOptions` is rebuilt every render, so it is read for labels but not depended on: a label
    // that arrives with the catalogue does not need to rebuild this list, and depending on it would
    // give the dialog a new `models` identity on every render of the pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  const chooseCard = (next: string) => {
    setChosenCard(next);
    // A discovered list belongs to the endpoint it came from, so leaving that endpoint discards it
    // along with whatever it had to say about the key and the URL.
    setDiscovered(null);
    setDiscoveryNote(null);
    setApiKeyError(null);
    setBaseUrlError(null);
    // `byoGrid`'s click handler corrects a URL belonging to the provider you just left, and leaves one
    // that already belongs to this provider alone.
    if (isByoCard(next)) setTypedBaseUrl(baseUrlForCard(next, baseUrl));
  };

  /**
   * V1 `CodingAgentStepView.cs:436-447`: a tier whose saved model is blank, or is not one of the models
   * this endpoint just listed, is reset to that tier's computed default.
   *
   * This is the "match them with what we have" half. A select cannot represent an id that is not in its
   * options, so a stale saved model would otherwise sit there looking chosen while the endpoint has
   * never heard of it. The reset marks the pane dirty, which is correct - the corrected value has to be
   * saved to take effect.
   */
  const applyDiscoveredDefaults = React.useCallback(
    (models: DiscoveredModel[], fetchedDefaults: ProfileDefaults) => {
      const offered = (id: string) =>
        id === DEFAULT_VALUE || models.some((model) => model.id.toLowerCase() === id.toLowerCase());
      setProfiles((prev) => ({
        deep: {
          ...prev.deep,
          model: offered(prev.deep.model) ? prev.deep.model : fetchedDefaults.deep,
        },
        balanced: {
          ...prev.balanced,
          model: offered(prev.balanced.model) ? prev.balanced.model : fetchedDefaults.balanced,
        },
        quick: {
          ...prev.quick,
          model: offered(prev.quick.model) ? prev.quick.model : fetchedDefaults.quick,
        },
      }));
    },
    [],
  );

  /**
   * V1's Continue handler, as one action: ask the endpoint what it serves and route the answer.
   *
   * The key is sent only when it has been typed and not yet saved; otherwise it is omitted and the
   * daemon uses the one in `config.yaml`, which is what makes this work for a key the operator gave
   * some other day. Each of the three failures lands on the field it is about.
   */
  const fetchModels = React.useCallback(
    async (agent: string, url: string, typedKey: string | null) => {
      setIsFetchingModels(true);
      setApiKeyError(null);
      setBaseUrlError(null);
      setDiscoveryNote(null);
      try {
        const outcome = await providerModelsApi.fetch({
          agent,
          baseUrl: url,
          ...(typedKey && typedKey.trim() !== "" ? { apiKey: typedKey } : {}),
        });

        switch (outcome.status) {
          case "models":
            setDiscovered(outcome.models);
            // A successful fetch is what puts the pane in select mode - V1 sets
            // `useCustomModelNames` to false right here.
            setCustomNames(false);
            setDiscoveryNote({ kind: "found", count: outcome.models.length });
            applyDiscoveredDefaults(outcome.models, outcome.defaults);
            break;
          case "customNames":
            // The endpoint answered a real prompt but lists no models, so there is nothing to select
            // from and the names have to be typed. V1 prefills them with the provider's defaults.
            setDiscovered([]);
            setCustomNames(true);
            setDiscoveryNote({ kind: "customNames" });
            // V1 prefills only an unset field (`IsNullOrWhiteSpace`). An unset tier reads back here as
            // the literal `default`, which is this pane's spelling of the same thing.
            setProfiles((prev) => {
              const prefill = (current: string, fallback: string) =>
                current.trim() === "" || current === DEFAULT_VALUE ? fallback : current;
              return {
                deep: { ...prev.deep, model: prefill(prev.deep.model, outcome.defaults.deep) },
                balanced: {
                  ...prev.balanced,
                  model: prefill(prev.balanced.model, outcome.defaults.balanced),
                },
                quick: { ...prev.quick, model: prefill(prev.quick.model, outcome.defaults.quick) },
              };
            });
            break;
          case "apiKeyError":
            // Deliberately no fallback to free text: a refused key has told us nothing about whether
            // the endpoint lists models.
            setApiKeyError(outcome.message);
            break;
          case "baseUrlError":
            setBaseUrlError(outcome.message);
            break;
        }
      } catch (err) {
        setDiscoveryNote({ kind: "unreachable", error: describeBridgeError(err) });
      } finally {
        setIsFetchingModels(false);
      }
    },
    [applyDiscoveredDefaults],
  );

  /**
   * "If the user already gave the key": one unprompted attempt per (agent, URL) when a key is already
   * on disk, so opening the pane on a configured provider shows its real models without being asked to
   * press anything.
   *
   * Keyed on the *saved* credentials only, and guarded by `attempted`, so typing in either field fires
   * nothing. The pane renders before, during and after this - it is never awaited on the render path.
   */
  React.useEffect(() => {
    if (!isByo || savedApiKey === "" || baseUrl.trim() === "") return;
    const attemptKey = `${finalAgent}|${baseUrl}`;
    if (attempted.current.has(attemptKey)) return;
    attempted.current.add(attemptKey);
    void fetchModels(finalAgent, baseUrl, null);
    // `apiKey`/`typedBaseUrl` are deliberately absent: this reacts to what is configured, not to what
    // is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isByo, finalAgent, savedApiKey, savedBaseUrl]);

  const agentIdChanged = finalAgent !== normalizeAgentName(savedAgent || "claude");
  const profilesChanged = JSON.stringify(profiles) !== JSON.stringify(savedProfiles);
  const detailsChanged = agentArguments !== savedArguments || agentEnv !== savedEnv;
  /** `hasCredsChanged`, including its Berget case: a URL that is not Berget's is itself a change. */
  const credsChanged =
    isByo &&
    (apiKey !== savedApiKey ||
      baseUrl !== savedBaseUrl ||
      (card === "berget_card" && !savedBaseUrl.toLowerCase().includes("api.berget.ai")));
  const hasChanges = agentIdChanged || profilesChanged || detailsChanged || credsChanged;

  // A `config.yaml` naming an agent no build of Tendril can launch leaves the grid with nothing
  // selected, which on its own reads as "not configured yet" rather than "misconfigured".
  const unknownAgent =
    savedAgent !== "" &&
    !CODING_AGENTS.some((agent) => agent.id === normalizeAgentName(savedAgent)) &&
    !["ivy", "openaiproxy", "proxy"].includes(normalizeAgentName(savedAgent))
      ? savedAgent
      : null;

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (agentIdChanged) await onSaveRaw("codingAgent", finalAgent);
      // Deliberately narrower than `CodingAgentSetupView`, which calls `SaveProfiles` on every save
      // and so materialises an `AgentConfig` with three blank profiles for any agent you merely
      // select. That is not inert in V2: `apply_profile` returns nothing at all when the agent has no
      // config entry, but falls back to the `balanced` tier once an entry exists, so writing the
      // empty entry would quietly change which model a job runs with.
      if (profilesChanged || detailsChanged || credsChanged) {
        let payload = withAgentSettings(entries, finalAgent, {
          profiles,
          arguments: agentArguments,
          environmentVariables: parseEnvLines(agentEnv),
        });
        // The credentials go on last so the provider fields win over the raw environment editor for
        // the two variables they both spell.
        if (isByo) payload = withByoCredentials(payload, card, baseUrl, apiKey);
        await onSaveRaw("codingAgents", payload);
      }
      notificationsStore.notifySuccess(t("save.toastTitle"), t("save.toastMessage"));
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingsSection title={t("section.title")} hint={t("section.hint")} testId="coding-agent-card">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {unknownAgent && (
          <Callout.Error data-testid="unknown-coding-agent">
            {unknownAgentMessage(t, unknownAgent)}
          </Callout.Error>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {CODING_AGENTS.map((agent) => (
            <AgentCard
              key={agent.id}
              id={agent.id}
              label={agent.label}
              icon={agent.icon}
              selected={card === agent.id}
              onClick={() => chooseCard(agent.id)}
            />
          ))}
        </div>

        {/* `Text.Block("Bring your own LLM").Bold()` and its own three-card grid. These are not agent
            ids: all three drive the `openaiproxy` agent, and the Ivy proxy resolves to `ivy`. */}
        <SubSection title={t("byo.title")} testId="byo-llm-block">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {BYO_CARDS.map((byo) => (
              <AgentCard
                key={byo.key}
                id={byo.key}
                label={byo.label}
                icon={byo.icon}
                selected={card === byo.key}
                onClick={() => chooseCard(byo.key)}
              />
            ))}
          </div>

          {isByo && (
            <div className="mt-3 max-w-120 space-y-3" data-testid="byo-credentials">
              {/* Berget's endpoint is fixed, so V1 shows it no URL field - only a key. */}
              {card !== "berget_card" && (
                <TextField
                  id="byo-base-url"
                  label={t("byo.baseUrl.label")}
                  value={baseUrl}
                  placeholder={
                    card === "anthropic_card"
                      ? "https://api.anthropic.com/v1"
                      : "https://api.openai.com"
                  }
                  /* The third of V1's three destinations for one failure: nothing answered here. */
                  error={baseUrlError}
                  onChange={(value) => {
                    setTypedBaseUrl(value);
                    setBaseUrlError(null);
                  }}
                />
              )}
              <div className="space-y-1">
                <Label htmlFor="byo-api-key" className="text-xs font-medium text-foreground">
                  {t("byo.apiKey.label")}
                </Label>
                <div className="flex items-start gap-2">
                  <Input
                    id="byo-api-key"
                    type="password"
                    value={apiKey}
                    placeholder="sk-..."
                    aria-invalid={apiKeyError ? true : undefined}
                    onChange={(e) => {
                      setTypedApiKey(e.target.value);
                      setApiKeyError(null);
                    }}
                  />
                  {/* V1 fetches on Continue; a settings pane has no Continue, so the same call is an
                      explicit action. It needs no key typed here: one already saved is read by the
                      daemon, which is the only side allowed to read it. */}
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="fetch-provider-models"
                    disabled={isFetchingModels || apiKey.trim() === ""}
                    onClick={() => void fetchModels(finalAgent, baseUrl, typedApiKey)}
                  >
                    {isFetchingModels ? t("byo.fetchModels.busy") : t("byo.fetchModels.label")}
                  </Button>
                </div>
                {apiKeyError ? (
                  <p className="text-xs text-destructive" data-testid="byo-api-key-error">
                    {apiKeyError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("byo.apiKey.hint", {
                      agent: finalAgent,
                      context: finalAgent === "ivy" ? "ivy" : undefined,
                    })}
                  </p>
                )}
                {discoveryNote && (
                  <p className="text-xs text-muted-foreground" data-testid="model-discovery-note">
                    {discoveryNoteText(t, discoveryNote)}
                  </p>
                )}
              </div>
            </div>
          )}
        </SubSection>

        {/* `CodingAgentSetupView`'s "Profile Models" block. `deep`, `balanced` and `quick` are the
            three tiers `apply_profile` maps by name; anything left as Default falls through to the
            agent's built-in tier default, which the placeholder names. */}
        <SubSection
          title={t("profiles.title")}
          hint={
            isCustomMode
              ? t("profiles.hint.custom")
              : discovered && discovered.length > 0
                ? // `CodingAgentStepView`'s wording for the same block once its fetch has come back.
                  t("profiles.hint.discovered")
                : t("profiles.hint.default")
          }
          testId="profile-models-block"
        >
          {/* V1 puts the strip above the whole `profileModels` stack, which in this build is the
              section it heads. First child, so the quota is read before the models it constrains. */}
          <AgentUsageStrip agent={finalAgent} />

          {isByo && modelOptions.length > 0 && (
            <div className="mb-3 flex items-center gap-3">
              <Switch
                id="custom-model-names"
                checked={customNames}
                onCheckedChange={setCustomNames}
              />
              <Label htmlFor="custom-model-names" className="text-xs font-medium text-foreground">
                {t("profiles.customNames")}
              </Label>
            </div>
          )}

          {!effortEnabled && (
            <p className="mb-2 text-xs text-muted-foreground" data-testid="effort-unsupported">
              {t("profiles.effortUnsupported")}
            </p>
          )}

          <div className="space-y-3">
            {PROFILE_TIERS.map((tier) => (
              <div key={tier} className="flex items-start gap-2">
                {/* `Width(Size.Fraction(0.65f))` against the effort select's `0.35f`, expressed as
                    grow weights over a zero basis rather than as percentage bases.
                    `basis-[65%] + basis-[35%]` is exactly 100% of the line before the `gap-2`
                    between them is counted, so on a wrapping row the pair never fit and the effort
                    select dropped to a line of its own at *every* width - which is not the layout
                    V1 draws. Weights divide what is left after the gap, so the ratio holds and the
                    row stays one line; `min-w-0` lets a long model name shrink rather than push its
                    neighbour out.

                    Aligned at the *start*, not the end: both columns open with the same `text-xs`
                    label above the same `h-9` control, so aligning tops lines the labels and the
                    selects up. */}
                <div
                  className={
                    effortEnabled ? "min-w-0 grow-[65] basis-0" : "min-w-0 grow basis-full"
                  }
                >
                  {isCustomMode ? (
                    <TextField
                      id={`profile-model-${tier}`}
                      label={tierLabel(t, tier)}
                      value={profiles[tier].model === DEFAULT_VALUE ? "" : profiles[tier].model}
                      placeholder={defaults[tier].model || DEFAULT_VALUE}
                      onChange={(value) =>
                        setProfiles((prev) => ({
                          ...prev,
                          [tier]: {
                            ...prev[tier],
                            model: value.trim() === "" ? DEFAULT_VALUE : value,
                          },
                        }))
                      }
                    />
                  ) : (
                    <NativeSelectField
                      id={`profile-model-${tier}`}
                      label={tierLabel(t, tier)}
                      /* The resolved model rather than the sentinel: a select shows a model or it shows
                         nothing sensible. */
                      value={shownTierModel(tier)}
                      options={modelOptions}
                      onChange={(value) =>
                        setProfiles((prev) => ({
                          ...prev,
                          [tier]: { ...prev[tier], model: value },
                        }))
                      }
                    />
                  )}
                </div>
                {/* No effort column at all when the CLI takes no effort argument, which is V1's own
                    branch rather than a disabled control that would still look settable. Its options
                    are `GetEffortOptions(<this row's model>)`, so they follow the select beside them. */}
                {effortEnabled && (
                  <div className="min-w-0 grow-[35] basis-0">
                    <NativeSelectField
                      id={`profile-effort-${tier}`}
                      label={t("profiles.effort")}
                      value={profiles[tier].effort}
                      options={effortOptionsFor(shownTierModel(tier))}
                      onChange={(value) =>
                        setProfiles((prev) => ({
                          ...prev,
                          [tier]: { ...prev[tier], effort: value },
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </SubSection>

        {/* `AgentConfig.arguments` and `AgentConfig.environmentVariables`: both are read by
            `resolve_agent_config` for every launch and have no editor at all in V1, which leaves them
            hand-editable in config.yaml only. */}
        <SubSection title={t("environment.title")} testId="agent-environment-block">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="agent-arguments" className="text-xs font-medium text-foreground">
                {t("environment.arguments.label")}
              </Label>
              <Input
                id="agent-arguments"
                value={agentArguments}
                placeholder={t("environment.arguments.placeholder")}
                onChange={(e) => setAgentArguments(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("environment.arguments.hint")}</p>
            </div>
            <LinesField
              id="agent-environment"
              label={t("environment.variables.label")}
              value={agentEnv}
              placeholder={"ANTHROPIC_API_KEY=sk-..."}
              hint={t("environment.variables.hint")}
              onChange={setAgentEnv}
            />
          </div>
        </SubSection>

        <AgentHelpBlock card={card} hints={agentHints} />

        <SaveError message={error === null ? null : t("save.failed", { error })} />

        {/* `Layout.Horizontal() | Test Agent | Save`, in that order. `type="button"` because this
            sits inside the settings form and a bare button in a form submits it - which would save
            the pane every time someone tested it. */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            data-testid="test-agent"
            disabled={isFetchingModels}
            onClick={() => setIsTestOpen(true)}
          >
            {t("actions.test")}
          </Button>
          <Button type="submit" disabled={!hasChanges || isSaving}>
            {isSaving ? t("actions.saving") : t("common:actions.save")}
          </Button>
        </div>

        {/* Tests the agent as *saved*, which is what a launch would use. Unsaved edits to the model
            fields are still what `testModels` reads, so the dialog checks what the pane shows - but
            an unsaved API key is not sent, because the daemon reads the key from `config.yaml`. */}
        <AgentTestDialog
          isOpen={isTestOpen}
          onClose={() => setIsTestOpen(false)}
          agent={finalAgent}
          models={testModels}
        />
      </form>
    </SettingsSection>
  );
};
