import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import { agentsApi } from "../src/api/agentsApi";
import {
  resetProviderModelsTransport,
  setProviderModelsTransport,
} from "../src/api/providerModelsApi";
import type {
  AgentOption,
  ProviderModelsOutcome,
  ProviderModelsRequest,
} from "../src/types/agents";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * `Apps/Settings/CodingAgentSetupView.cs`'s two grids, its bring-your-own-LLM credentials and its
 * profile models - and, at the end, that what this pane writes is what `resolve_agent` reads.
 *
 * The last part is a shared fixture: `crates/tendril-core/tests/fixtures/settings-ui-payload.json`
 * holds the exact `PUT /api/config` body produced here, and
 * `crates/tendril-core/tests/settings_ui_write_path_test.rs` merges that file into a config.yaml,
 * loads it and asserts the resolution. If either side drifts, one of the two tests fails.
 */

const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../crates/tendril-core/tests/fixtures/settings-ui-payload.json",
);

const baseConfig: TendrilConfig = {
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
  raw: { staleOutputTimeout: 10, beta: false, themeMode: "system" },
};

const serviceInfo: ServiceInfo = {
  state: "Connected",
  tendrilHome: "/home/user/.tendril",
  port: 5010,
  host: "127.0.0.1",
  ownership: "Managed",
  statusBadge: "Connected (Managed)",
  capabilities: ["plans"],
  message: "Online",
};

const DEFAULT_EFFORT = { id: "default", displayName: "Default" };
const CLAUDE_LADDER = [
  DEFAULT_EFFORT,
  { id: "high", displayName: "High" },
  { id: "max", displayName: "Max" },
];
const COPILOT_LADDER = [DEFAULT_EFFORT, { id: "high", displayName: "High" }];

/**
 * A trimmed `GET /api/agents`, in the shape `agents/catalog.rs` serves - including the per-model
 * `efforts` a row carries when its ladder is not its agent's.
 */
const CATALOG: AgentOption[] = [
  {
    id: "claude",
    label: "Claude",
    models: [
      { id: "claude-opus-5", displayName: "Claude Opus 5", efforts: CLAUDE_LADDER },
      { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", efforts: CLAUDE_LADDER },
    ],
    defaultModel: "claude-opus-5",
    supportsEffort: true,
    efforts: CLAUDE_LADDER,
  },
  {
    id: "codex",
    label: "Codex",
    models: [{ id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" }],
    defaultModel: "gpt-5.6-sol",
    supportsEffort: true,
    efforts: [DEFAULT_EFFORT, { id: "none", displayName: "None" }],
  },
  {
    id: "copilot",
    label: "Copilot",
    models: [
      // V1 `CopilotModelCatalog`: the GPT rows carry Copilot's ladder and the Claude rows carry
      // Claude's, which is the whole point of resolving efforts per model.
      { id: "gpt-5.4", displayName: "GPT-5.4", efforts: COPILOT_LADDER },
      { id: "claude-opus-5", displayName: "Claude Opus 5", efforts: CLAUDE_LADDER },
    ],
    defaultModel: "gpt-5.4",
    supportsEffort: true,
    efforts: COPILOT_LADDER,
  },
  {
    id: "gemini",
    label: "Gemini",
    models: [{ id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" }],
    defaultModel: "gemini-3.7-flash",
    supportsEffort: false,
    efforts: [],
  },
  {
    id: "opencode",
    label: "OpenCode",
    models: [
      { id: "claude-opus-5", displayName: "Claude Opus 5" },
      { id: "moonshotai/Kimi-K3", displayName: "Kimi K3" },
    ],
    defaultModel: "moonshotai/Kimi-K3",
    supportsEffort: true,
    efforts: [
      DEFAULT_EFFORT,
      { id: "low", displayName: "Low" },
      { id: "high", displayName: "High" },
      { id: "max", displayName: "Max" },
    ],
  },
  {
    // The daemon resolves this row from the `ANTHROPIC_BASE_URL` on disk, so with nothing saved it is
    // OpenAI's list - which is why the pane must not use it for a card pointed somewhere else.
    id: "openaiproxy",
    label: "OpenAI Proxy",
    models: [
      { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" },
      { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
    ],
    defaultModel: "gpt-5.6-sol",
    supportsEffort: true,
    efforts: [DEFAULT_EFFORT, { id: "high", displayName: "High" }],
  },
];

async function renderSettings() {
  await act(async () => {
    render(
      <SettingsView
        serviceInfo={serviceInfo}
        onRefreshHealth={vi.fn()}
        initialSection="coding-agent"
      />,
    );
  });
}

const saveAgent = async () => {
  const card = screen.getByTestId("coding-agent-card");
  const button = Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Save");
  if (!button) throw new Error("No Save button in the coding agent card");
  await act(async () => {
    fireEvent.click(button);
  });
};

const clickCard = async (id: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`coding-agent-${id}`));
  });
};

describe("Settings / Coding Agent", () => {
  let putConfig: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ ...baseConfig });
    putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue({
      source: "static",
      totalModelCount: 0,
      dynamicModelCount: 0,
      staticModelCount: 0,
      enrichModels: false,
      cachedAt: null,
      cachePath: "/home/user/.tendril/models.json",
    });
    vi.spyOn(agentsApi, "listAgents").mockResolvedValue(CATALOG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetProviderModelsTransport();
  });

  /** `modelOptions`: the catalogue `GET /api/agents` serves, real models only. */
  it("drives the profile model and effort from the agent catalogue", async () => {
    await renderSettings();

    const deep = screen.getByLabelText("Deep") as HTMLSelectElement;
    expect(Array.from(deep.options).map((o) => o.value)).toEqual([
      "claude-opus-5",
      "claude-sonnet-5",
    ]);

    const effort = screen.getByLabelText("Effort", { selector: "#profile-effort-deep" });
    expect(Array.from((effort as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      "default",
      "high",
      "max",
    ]);
  });

  /**
   * No synthetic `default` model, anywhere. V1 has none: one catalogue row carries `IsDefault`, the
   * sorter pins it first, and `ChatApp.ResolveModel` resolves "the default" to that real id. A tier with
   * nothing configured therefore shows the model it will actually use, and the select offers no row that
   * names no model.
   */
  it("shows a real model for an unset tier and offers no `default` row", async () => {
    await renderSettings();

    for (const tier of ["Deep", "Balanced", "Quick"]) {
      const select = screen.getByLabelText(tier) as HTMLSelectElement;
      const ids = Array.from(select.options).map((o) => o.value);
      expect(ids).not.toContain("default");
      expect(ids).toEqual(["claude-opus-5", "claude-sonnet-5"]);
      // The unset tier resolves to a concrete model rather than displaying a sentinel.
      expect(select.value).toBe("claude-opus-5");
    }
    expect(screen.getAllByText(/this is the built-in default/i).length).toBe(3);

    // ...and the effort keeps its Default option, which is V1's own behaviour.
    const effort = screen.getByLabelText("Effort", {
      selector: "#profile-effort-deep",
    }) as HTMLSelectElement;
    expect(Array.from(effort.options).map((o) => o.value)).toContain("default");
  });

  /**
   * Displaying the resolved model must not silently write it: an unset tier means "no opinion", which
   * `apply_profile` answers with the built-in tier default. Writing a concrete id there would pin a
   * model that nobody chose.
   */
  it("does not write a model for a tier nobody touched", async () => {
    await renderSettings();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Extra Arguments"), {
        target: { value: "--verbose" },
      });
    });
    await saveAgent();

    const [, value] = putConfig.mock.calls[0] as [string, Record<string, unknown>[]];
    expect(value[0]).toMatchObject({
      profiles: [
        { name: "deep", model: "", effort: "" },
        { name: "balanced", model: "", effort: "" },
        { name: "quick", model: "", effort: "" },
      ],
    });
  });

  /**
   * **The bug.** Selecting an agent must never offer another provider's models. The pane asks the
   * catalogue for the agent in front of the operator, so the Claude card offers Anthropic's models and
   * only those - no Gemini row from the Ivy splice, no GPT row from the proxy's saved list.
   */
  it("offers only the selected agent's own models", async () => {
    await renderSettings();

    const optionsOf = (label: string) =>
      Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value);

    for (const tier of ["Deep", "Balanced", "Quick"]) {
      const ids = optionsOf(tier);
      expect(ids.every((id) => id.startsWith("claude-"))).toBe(true);
      expect(ids.some((id) => id.includes("gemini"))).toBe(false);
      expect(ids.some((id) => id.startsWith("gpt-"))).toBe(false);
    }

    await clickCard("codex");
    expect(optionsOf("Deep")).toEqual(["gpt-5.6-sol"]);
    expect(optionsOf("Deep").some((id) => id.startsWith("claude-"))).toBe(false);
  });

  /**
   * `GetEffortOptions(deepModel.Value)`: V1 builds each row's effort select from the model chosen
   * beside it, because `SupportedEfforts` is declared per catalogue row. Copilot on a Claude model
   * therefore offers `max`, which its own ladder does not have.
   */
  it("resolves each profile's effort options from the model chosen beside it", async () => {
    await renderSettings();
    await clickCard("copilot");

    const effortIds = () =>
      Array.from(
        (
          screen.getByLabelText("Effort", {
            selector: "#profile-effort-deep",
          }) as HTMLSelectElement
        ).options,
      ).map((o) => o.value);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Deep"), { target: { value: "gpt-5.4" } });
    });
    expect(effortIds()).toEqual(["default", "high"]);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Deep"), { target: { value: "claude-opus-5" } });
    });
    expect(effortIds()).toEqual(["default", "high", "max"]);

    // The row beside an untouched tier keeps the agent's own ladder.
    expect(
      Array.from(
        (
          screen.getByLabelText("Effort", {
            selector: "#profile-effort-quick",
          }) as HTMLSelectElement
        ).options,
      ).map((o) => o.value),
    ).toEqual(["default", "high"]);
  });

  /**
   * `GetModelsForBaseUrl`: the proxy's catalogue follows the URL in front of the operator. The daemon
   * resolves its `openaiproxy` row from the URL *on disk*, so picking Anthropic has to take Claude's
   * catalogue - otherwise the Anthropic card offers whatever the proxy was last saved against, Gemini
   * rows included.
   */
  it("shows the BYO provider's own models rather than the saved proxy's", async () => {
    await renderSettings();

    await clickCard("anthropic_card");

    const ids = Array.from((screen.getByLabelText("Deep") as HTMLSelectElement).options).map(
      (o) => o.value,
    );
    expect(ids).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect(ids.some((id) => id.includes("gemini"))).toBe(false);
  });

  /**
   * `agent_capabilities`: Gemini's CLI takes no effort argument, and V1 drops the effort column
   * altogether in that case (`supportsEffort ? ... : ...`) rather than showing a settable-looking one.
   */
  it("drops the effort column for an agent whose CLI has none", async () => {
    await renderSettings();
    await clickCard("gemini");

    expect(screen.getByTestId("effort-unsupported")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Effort", { selector: "#profile-effort-deep" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a model id the catalogue has never heard of selectable", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue({
      ...baseConfig,
      raw: {
        ...baseConfig.raw,
        codingAgents: [{ name: "claude", profiles: [{ name: "deep", model: "opus-4" }] }],
      },
    });
    await renderSettings();

    const deep = screen.getByLabelText("Deep") as HTMLSelectElement;
    expect(deep.value).toBe("opus-4");
    expect(Array.from(deep.options).map((o) => o.value)).toContain("opus-4");
  });

  /** `byoGrid`'s click handler, which corrects a URL belonging to the provider you just left. */
  it("prefills the Anthropic card's base URL and asks only for a key on Berget", async () => {
    await renderSettings();

    await clickCard("anthropic_card");
    expect(screen.getByLabelText("API Base URL")).toHaveValue("https://api.anthropic.com/v1");

    await clickCard("berget_card");
    expect(screen.queryByLabelText("API Base URL")).not.toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
  });

  /**
   * `SaveOpenAiProxyBaseUrl` / `SaveOpenAiProxyApiKey`: one field becomes two variables, because the
   * Anthropic SDK wants the bare host and the OpenAI one wants it with `/v1`.
   */
  it("writes a BYO provider as openaiproxy plus its environment", async () => {
    await renderSettings();

    await clickCard("anthropic_card");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
    });
    await saveAgent();

    expect(putConfig).toHaveBeenNthCalledWith(1, "codingAgent", "openaiproxy");
    const [key, value] = putConfig.mock.calls[1] as [string, Record<string, unknown>[]];
    expect(key).toBe("codingAgents");
    expect(value).toHaveLength(1);
    expect(value[0]).toMatchObject({
      name: "openaiproxy",
      environmentVariables: {
        ANTHROPIC_API_KEY: "sk-test",
        OPENAI_API_KEY: "sk-test",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        OPENAI_BASE_URL: "https://api.anthropic.com/v1",
      },
    });
  });

  /** Berget's endpoint is fixed, so V1 forces it on save whatever the field said. */
  it("forces Berget's endpoint on save", async () => {
    await renderSettings();

    await clickCard("berget_card");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-berget" } });
    });
    await saveAgent();

    const [, value] = putConfig.mock.calls[1] as [string, Record<string, unknown>[]];
    expect(value[0]).toMatchObject({
      environmentVariables: {
        ANTHROPIC_BASE_URL: "https://api.berget.ai",
        OPENAI_BASE_URL: "https://api.berget.ai/v1",
      },
    });
  });

  /** `SaveIvyApiKey` writes the Ivy variables **and** the proxy ones, on both entries. */
  it("treats the Ivy proxy URL as the ivy agent and writes both entries", async () => {
    await renderSettings();

    await clickCard("openaiproxy_card");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("API Base URL"), {
        target: { value: "https://llmproxy.ivy.app" },
      });
      fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-ivy" } });
    });
    await saveAgent();

    expect(putConfig).toHaveBeenNthCalledWith(1, "codingAgent", "ivy");
    const [, value] = putConfig.mock.calls[1] as [string, Record<string, unknown>[]];
    expect(value.map((entry) => entry.name)).toEqual(["ivy", "openaiproxy"]);
    expect(value[0].environmentVariables).toMatchObject({
      IVY_API_KEY: "sk-ivy",
      ANTHROPIC_API_KEY: "sk-ivy",
      OPENAI_API_KEY: "sk-ivy",
      IVY_BASE_URL: "https://llmproxy.ivy.app",
      OPENAI_BASE_URL: "https://llmproxy.ivy.app/v1",
    });
    expect(value[1].environmentVariables).not.toHaveProperty("IVY_API_KEY");
  });

  /**
   * The contract with `resolve_agent`. Everything this pane can set - the agent id, a tier's model and
   * effort, the extra arguments and the environment - is written here in one payload, and that payload
   * is the fixture the Rust side resolves. Nothing about this test is cosmetic: if the shape changes,
   * the settings stop reaching the launch.
   */
  it("writes the payload `resolve_agent` is proven to consume", async () => {
    await renderSettings();

    await clickCard("anthropic_card");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-fixture" } });
      fireEvent.change(screen.getByLabelText("API Base URL"), {
        target: { value: "https://api.anthropic.com/v1" },
      });
    });
    // The BYO cards are in custom-name mode until the switch is flipped, so the model is typed.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Custom model names"));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Deep"), { target: { value: "claude-opus-5" } });
      fireEvent.change(screen.getByLabelText("Effort", { selector: "#profile-effort-deep" }), {
        target: { value: "max" },
      });
      fireEvent.change(screen.getByLabelText("Extra Arguments"), {
        target: { value: "--verbose --no-color" },
      });
      fireEvent.change(screen.getByLabelText("Environment Variables"), {
        target: { value: "TENDRIL_TEST=1" },
      });
    });
    await saveAgent();

    const body = {
      codingAgent: putConfig.mock.calls[0][1],
      codingAgents: putConfig.mock.calls[1][1],
    };

    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as unknown;
    expect(body).toEqual(fixture);
  });

  /**
   * Live discovery — `POST /api/agents/models`, V1's `FetchModelsDetailedAsync` and the routing around
   * it (`Apps/Onboarding/CodingAgentStepView.cs:334-447`).
   *
   * The daemon does the asking, so these drive the transport rather than the network: the point under
   * test is what the pane does with each of the four answers.
   */
  describe("model discovery", () => {
    const savedProxy = (env: Record<string, string>): TendrilConfig => ({
      ...baseConfig,
      codingAgent: "openaiproxy",
      raw: {
        ...baseConfig.raw,
        codingAgents: [
          {
            name: "openaiproxy",
            environmentVariables: env,
            profiles: [{ name: "deep", model: "gpt-retired-3" }],
          },
        ],
      },
    });

    const stub = (outcome: ProviderModelsOutcome) => {
      const calls: ProviderModelsRequest[] = [];
      setProviderModelsTransport((request) => {
        calls.push(request);
        return Promise.resolve(outcome);
      });
      return calls;
    };

    const FOUND: ProviderModelsOutcome = {
      status: "models",
      provider: "openAi",
      models: [
        { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" },
        { id: "gpt-5.6-terra", displayName: "GPT-5.6-Terra" },
        { id: "house-blend-1", displayName: "House Blend" },
      ],
      defaults: { deep: "gpt-5.6-sol", balanced: "gpt-5.6-terra", quick: "gpt-5.6-terra" },
    };

    /**
     * "If the user already gave the key": a configured provider is asked once when the pane opens, with
     * no key in the request — the daemon reads the saved one, which is the only side allowed to.
     */
    it("fetches once on open when a key is already saved, without sending it", async () => {
      vi.spyOn(bridge, "getConfig").mockResolvedValue(
        savedProxy({
          OPENAI_API_KEY: "sk-saved",
          ANTHROPIC_BASE_URL: "https://api.openai.com",
        }),
      );
      const calls = stub(FOUND);

      await renderSettings();

      expect(calls).toHaveLength(1);
      expect(calls[0].agent).toBe("openaiproxy");
      expect(calls[0].apiKey).toBeUndefined();
      expect(screen.getByTestId("model-discovery-note")).toHaveTextContent("Found 3 models");

      // The endpoint's own list drives the selects, in place of the declared catalogue.
      const ids = Array.from((screen.getByLabelText("Deep") as HTMLSelectElement).options).map(
        (o) => o.value,
      );
      // No synthetic `default` row: real models only, in the order the endpoint's resolver returned.
      expect(ids).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "house-blend-1"]);

      // `:436-447`: a saved model this endpoint has never heard of is reset to the tier's default
      // rather than left sitting in a select that cannot represent it.
      expect((screen.getByLabelText("Deep") as HTMLSelectElement).value).toBe("gpt-5.6-sol");
    });

    /** A typed-but-unsaved key is the one case where the pane sends it. */
    it("sends a freshly typed key and fetches on demand", async () => {
      const calls = stub(FOUND);
      await renderSettings();
      await clickCard("openaiproxy_card");

      await act(async () => {
        fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-typed" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("fetch-provider-models"));
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].apiKey).toBe("sk-typed");
      expect(calls[0].baseUrl).toBe("https://api.openai.com");
    });

    /**
     * A refused key is an error on the **API-key field** and nothing else: it must not fall through to
     * the free-text fields, because an endpoint that rejected the credential has said nothing about
     * whether it lists models.
     */
    it("puts a rejected key on the API key field and stays in select mode", async () => {
      stub({ status: "apiKeyError", message: "Incorrect API key provided: ***" });
      await renderSettings();
      await clickCard("openaiproxy_card");
      await act(async () => {
        fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-wrong" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("fetch-provider-models"));
      });

      expect(screen.getByTestId("byo-api-key-error")).toHaveTextContent("Incorrect API key");
      // Still a select, and still the declared catalogue behind it.
      expect((screen.getByLabelText("Deep") as HTMLSelectElement).tagName).toBe("SELECT");
    });

    /** An address that does not answer is an error on the **base-URL** field. */
    it("puts an unreachable endpoint on the base URL field", async () => {
      stub({ status: "baseUrlError", message: "Could not connect to the endpoint" });
      await renderSettings();
      await clickCard("openaiproxy_card");
      await act(async () => {
        fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-typed" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("fetch-provider-models"));
      });

      expect(screen.getByLabelText("API Base URL")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("Could not connect to the endpoint")).toBeInTheDocument();
    });

    /**
     * An endpoint that answers a real prompt but lists no models is the case the switch exists for: the
     * fields become free text, prefilled with the provider's defaults.
     */
    it("falls back to typed model names when the endpoint lists none", async () => {
      stub({
        status: "customNames",
        provider: "generic",
        defaults: { deep: "gpt-5.6-sol", balanced: "gpt-5.6-terra", quick: "gpt-5.6-luna" },
      });
      await renderSettings();
      await clickCard("openaiproxy_card");
      await act(async () => {
        fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-typed" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("fetch-provider-models"));
      });

      const deep = screen.getByLabelText("Deep");
      expect(deep.tagName).toBe("INPUT");
      expect(deep).toHaveValue("gpt-5.6-sol");
      expect(screen.getByTestId("model-discovery-note")).toHaveTextContent("no model list");
    });

    /** Typing must not fire requests, and the unprompted attempt must happen at most once. */
    it("does not fetch on a keystroke", async () => {
      vi.spyOn(bridge, "getConfig").mockResolvedValue(
        savedProxy({ OPENAI_API_KEY: "sk-saved", ANTHROPIC_BASE_URL: "https://api.openai.com" }),
      );
      const calls = stub(FOUND);
      await renderSettings();
      expect(calls).toHaveLength(1);

      await act(async () => {
        fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-typing" } });
        fireEvent.change(screen.getByLabelText("API Base URL"), {
          target: { value: "https://api.openai.com/v" },
        });
      });

      expect(calls).toHaveLength(1);
    });

    /**
     * The line this feature must not cross: a discovered model belongs to the endpoint that listed it
     * and never joins an agent's declared catalogue. Switching to a bundled agent shows that agent's own
     * models, with no trace of what some proxy happened to serve.
     */
    it("keeps discovered models out of every declared agent catalogue", async () => {
      const calls = stub(FOUND);
      await renderSettings();
      await clickCard("openaiproxy_card");
      await act(async () => {
        fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-typed" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("fetch-provider-models"));
      });
      expect(calls).toHaveLength(1);

      await clickCard("claude");
      const ids = Array.from((screen.getByLabelText("Deep") as HTMLSelectElement).options).map(
        (o) => o.value,
      );
      expect(ids).toEqual(["claude-opus-5", "claude-sonnet-5"]);
      expect(ids).not.toContain("house-blend-1");
    });
  });
});
