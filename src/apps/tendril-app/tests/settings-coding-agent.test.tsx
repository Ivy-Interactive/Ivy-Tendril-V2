import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import { agentsApi } from "../src/api/agentsApi";
import type { AgentOption } from "../src/types/agents";
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

/** A trimmed `GET /api/agents`, in the shape `agents/catalog.rs` serves. */
const CATALOG: AgentOption[] = [
  {
    id: "claude",
    label: "Claude",
    models: [
      { id: "default", displayName: "Default" },
      { id: "claude-opus-5", displayName: "Claude Opus 5" },
      { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
    ],
    supportsEffort: true,
    efforts: [
      { id: "default", displayName: "Default" },
      { id: "high", displayName: "High" },
      { id: "max", displayName: "Max" },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    models: [
      { id: "default", displayName: "Default" },
      { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
    ],
    supportsEffort: false,
    efforts: [],
  },
  {
    id: "opencode",
    label: "OpenCode",
    models: [
      { id: "default", displayName: "Default" },
      { id: "claude-opus-5", displayName: "Claude Opus 5" },
      { id: "moonshotai/Kimi-K3", displayName: "Kimi K3" },
    ],
    supportsEffort: true,
    efforts: [
      { id: "default", displayName: "Default" },
      { id: "low", displayName: "Low" },
      { id: "high", displayName: "High" },
      { id: "max", displayName: "Max" },
    ],
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
  });

  /** `modelOptions`: `Default` plus the catalogue, which is what `GET /api/agents` serves. */
  it("drives the profile model and effort from the agent catalogue", async () => {
    await renderSettings();

    const deep = screen.getByLabelText("deep") as HTMLSelectElement;
    expect(Array.from(deep.options).map((o) => o.value)).toEqual([
      "default",
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

    const deep = screen.getByLabelText("deep") as HTMLSelectElement;
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
      fireEvent.change(screen.getByLabelText("deep"), { target: { value: "claude-opus-5" } });
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
});
