import React from "react";
import { BrandIcon } from "@ivy-interactive/components/tendril";
import { Button, Callout, Input, Label, Switch } from "@ivy-interactive/components/ui";
import { Check } from "lucide-react";
import { agentsApi } from "../../api/agentsApi";
import { notificationsStore } from "../../state/notificationsStore";
import { describeBridgeError, type TendrilConfig } from "../../types/api";
import { DEFAULT_OPTION_ID, type AgentOption } from "../../types/agents";
import { formatEnvLines, parseEnvLines } from "./configValues";
import { normalizeAgentName } from "./projectConfig";
import {
  LinesField,
  NativeSelectField,
  SaveError,
  SectionCard,
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
 * Two of V1's blocks have no counterpart in this build and are stated rather than faked - see the
 * note at the foot of the pane.
 */

/** `EffortLevels.Claude`, V1's fallback when neither the model nor the descriptor names any. */
const FALLBACK_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const effortLabel = (id: string): string =>
  ({
    default: "Default",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
  })[id] ?? id;

/** `ConfigCommand.ValidateCodingAgent`'s refusal, with the same sorted valid-agent list. */
const unknownAgentMessage = (value: string): string =>
  `Unknown coding agent '${value}'. Valid agents: ${CODING_AGENTS.map((a) => a.id)
    .slice()
    .sort()
    .join(", ")}`;

/** One card in either grid: `new Card(logo | label | Spacer | check).OnClick(...)`. */
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
    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
      selected ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
    }`}
  >
    <BrandIcon name={icon} size={32} className="text-foreground" />
    <span className="text-sm font-medium text-foreground">{label}</span>
    {selected && <Check className="ml-auto size-4 text-primary" aria-hidden="true" />}
  </button>
);

export const CodingAgentSection: React.FC<{
  config: TendrilConfig | null;
  /** `config.yaml`'s `codingAgent`, i.e. what is on disk rather than what is selected. */
  savedAgent: string;
  /** Writes one key and re-reads the config (`SettingsView`'s `saveRawKey`). */
  onSaveRaw: (key: string, value: unknown) => Promise<void>;
}> = ({ config, savedAgent, onSaveRaw }) => {
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
  const [error, setError] = React.useState<string | null>(null);

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
      ),
  );
  const modelOptions = (catalogAgent?.models ?? []).map((model) => ({
    value: model.id,
    label: model.displayName,
  }));
  const effortOptions = (
    catalogAgent?.supportsEffort
      ? catalogAgent.efforts.map((effort) => effort.id)
      : catalogAgent
        ? []
        : [DEFAULT_OPTION_ID, ...FALLBACK_EFFORTS]
  ).map((id) => ({ value: id, label: effortLabel(id) }));

  const isByo = isByoCard(card);
  /**
   * V1 offers free text only for a BYO provider, and only once its `/models` call has come back. This
   * build has no per-provider `/models` client, so the rule is widened by one case: an empty catalogue
   * also means free text, because a model field that cannot be edited while the daemon is unreachable
   * is worse than one that accepts an id V2 has not heard of.
   */
  const isCustomMode = modelOptions.length === 0 || (isByo && customNames);
  const effortEnabled = supportsEffort(finalAgent) && effortOptions.length > 0;
  const defaults = tierDefaults(finalAgent, baseUrl);

  const chooseCard = (next: string) => {
    setChosenCard(next);
    // `byoGrid`'s click handler corrects a URL belonging to the provider you just left, and leaves one
    // that already belongs to this provider alone.
    if (isByoCard(next)) setTypedBaseUrl(baseUrlForCard(next, baseUrl));
  };

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
      notificationsStore.notifySuccess("Saved", "Coding agent settings saved");
    } catch (err) {
      setError(`Failed to save: ${describeBridgeError(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionCard
      title="Coding Agent"
      hint="Tendril connects to your configured AI coding agent or bundled open source engines like OpenCode."
      testId="coding-agent-card"
    >
      <form
        className="max-w-170 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {unknownAgent && (
          <Callout.Error data-testid="unknown-coding-agent">
            {unknownAgentMessage(unknownAgent)}
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
        <SubSection title="Bring your own LLM" testId="byo-llm-block">
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
                  label="API Base URL"
                  value={baseUrl}
                  placeholder={
                    card === "anthropic_card"
                      ? "https://api.anthropic.com/v1"
                      : "https://api.openai.com"
                  }
                  onChange={setTypedBaseUrl}
                />
              )}
              <div className="space-y-1">
                <Label htmlFor="byo-api-key" className="text-xs font-medium text-muted-foreground">
                  API Key
                </Label>
                <Input
                  id="byo-api-key"
                  type="password"
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={(e) => setTypedApiKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Stored as {finalAgent === "ivy" ? "IVY_API_KEY, " : ""}ANTHROPIC_API_KEY and
                  OPENAI_API_KEY on the {finalAgent} agent, which is the environment every launch
                  gets.
                </p>
              </div>
            </div>
          )}
        </SubSection>

        {/* `CodingAgentSetupView`'s "Profile Models" block. `deep`, `balanced` and `quick` are the
            three tiers `apply_profile` maps by name; anything left as Default falls through to the
            agent's built-in tier default, which the placeholder names. */}
        <SubSection
          title="Profile Models"
          hint={
            isCustomMode
              ? "Specify custom model names and effort level to use for each profile."
              : "Promptwares are configured to use different profiles depending on the complexity of the task. You can specify what model and effort level to use for each profile."
          }
          testId="profile-models-block"
        >
          {isByo && modelOptions.length > 0 && (
            <div className="mb-3 flex items-center gap-3">
              <Switch
                id="custom-model-names"
                checked={customNames}
                onCheckedChange={setCustomNames}
              />
              <Label htmlFor="custom-model-names" className="text-xs font-medium text-foreground">
                Custom model names
              </Label>
            </div>
          )}

          {!effortEnabled && (
            <p className="mb-2 text-xs text-muted-foreground" data-testid="effort-unsupported">
              This agent&apos;s CLI takes no effort argument, so effort is ignored.
            </p>
          )}

          <div className="space-y-3">
            {PROFILE_TIERS.map((tier) => (
              <div key={tier} className="flex flex-wrap items-end gap-2">
                {/* `Width(Size.Fraction(0.65f))` against the effort select's `0.35f`. */}
                <div className={effortEnabled ? "min-w-56 grow basis-2/3" : "min-w-56 grow"}>
                  {isCustomMode ? (
                    <div className="space-y-1">
                      <Label
                        htmlFor={`profile-model-${tier}`}
                        className="text-xs font-medium text-muted-foreground capitalize"
                      >
                        {tier}
                      </Label>
                      <Input
                        id={`profile-model-${tier}`}
                        value={profiles[tier].model === DEFAULT_VALUE ? "" : profiles[tier].model}
                        placeholder={defaults[tier].model || DEFAULT_VALUE}
                        onChange={(e) =>
                          setProfiles((prev) => ({
                            ...prev,
                            [tier]: {
                              ...prev[tier],
                              model: e.target.value.trim() === "" ? DEFAULT_VALUE : e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  ) : (
                    <NativeSelectField
                      id={`profile-model-${tier}`}
                      label={tier}
                      value={profiles[tier].model}
                      options={modelOptions}
                      hint={
                        profiles[tier].model === DEFAULT_VALUE && defaults[tier].model !== ""
                          ? `Default: ${defaults[tier].model}`
                          : undefined
                      }
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
                    branch rather than a disabled control that would still look settable. */}
                {effortEnabled && (
                  <div className="min-w-32 basis-1/3">
                    <NativeSelectField
                      id={`profile-effort-${tier}`}
                      label="Effort"
                      value={profiles[tier].effort}
                      options={effortOptions}
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
        <SubSection title="Extra Arguments &amp; Environment" testId="agent-environment-block">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label
                htmlFor="agent-arguments"
                className="text-xs font-medium text-muted-foreground"
              >
                Extra Arguments
              </Label>
              <Input
                id="agent-arguments"
                value={agentArguments}
                placeholder="e.g. --verbose"
                onChange={(e) => setAgentArguments(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Split on whitespace and appended to every launch of this agent.
              </p>
            </div>
            <LinesField
              id="agent-environment"
              label="Environment Variables"
              value={agentEnv}
              placeholder={"ANTHROPIC_API_KEY=sk-..."}
              hint="One KEY=value per line. Lines starting with # are ignored."
              onChange={setAgentEnv}
            />
          </div>
        </SubSection>

        <SaveError message={error} />

        <Button type="submit" disabled={!hasChanges || isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>

        {/* Stated rather than offered, as in `SecurityTunnelingSection`. */}
        <Callout.Info data-testid="agent-gaps-note">
          <div className="space-y-1 text-xs">
            <p>
              V1&apos;s <strong>Test Agent</strong> dialog is missing because the daemon has no
              route that runs a one-off prompt against an agent, so there is nothing for it to call.
            </p>
            <p>
              V1&apos;s usage strip (the rate-limit windows above the profiles) needs a per-agent
              usage snapshot, which this build does not collect.
            </p>
          </div>
        </Callout.Info>
      </form>
    </SectionCard>
  );
};
