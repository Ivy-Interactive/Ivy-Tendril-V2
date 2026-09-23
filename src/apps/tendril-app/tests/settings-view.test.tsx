import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import {
  resetPromptwareProgramTransport,
  setPromptwareProgramTransport,
} from "../src/api/promptwaresApi";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * Port of `SettingsApp`'s root setup views. Each section saves on its own, its Save stays disabled
 * until that section changes (`hasChanges` in every V1 setup view), and `jobTimeout` is minutes -
 * `TendrilSettings::job_timeout` is documented as minutes, unlike `daemonRequestTimeout`.
 *
 * `SettingsApp` is a nested sidebar and renders **only the selected row's view**, so every test here
 * opens its section first - through `initialSection`, which is V1's `SettingsAppArgs.Section`, or by
 * clicking the row. Before the structural pass every section was mounted at once, which is why these
 * tests previously needed no navigation at all.
 */

/**
 * Radix's Select scrolls the highlighted option into view as soon as its content mounts, and jsdom
 * implements neither this nor the pointer-capture methods its item handlers call. Stubbed here
 * rather than in `src/test/setup.ts` because this is the only file in the suite that opens one.
 */
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}
if (!window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
}
if (!window.HTMLElement.prototype.releasePointerCapture) {
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
}

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

async function renderSettings(section = "coding-agent", onRefreshHealth = vi.fn()) {
  await act(async () => {
    render(
      <SettingsView
        serviceInfo={serviceInfo}
        onRefreshHealth={onRefreshHealth}
        initialSection={section}
      />,
    );
  });
}

/** Clicking a sidebar row, the way an operator moves between sections. */
const gotoSection = async (tag: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`settings-row-${tag}`));
  });
};

/** The Save inside one section card, since every section now carries its own. */
const saveIn = (testId: string) => {
  const card = screen.getByTestId(testId);
  const button = Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Save");
  if (!button) throw new Error(`No Save button in ${testId}`);
  return button;
};

const submitIn = async (testId: string) => {
  await act(async () => {
    fireEvent.click(saveIn(testId));
  });
};

describe("SettingsView", () => {
  let getConfig: ReturnType<typeof vi.spyOn>;
  let putConfig: ReturnType<typeof vi.spyOn>;
  let saveUiState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getConfig = vi.spyOn(bridge, "getConfig").mockResolvedValue({ ...baseConfig });
    putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    saveUiState = vi.spyOn(bridge, "saveUiState").mockResolvedValue(undefined);
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue({
      source: "static",
      totalModelCount: 0,
      dynamicModelCount: 0,
      staticModelCount: 0,
      enrichModels: false,
      cachedAt: null,
      cachePath: "/home/user/.tendril/models.json",
    });
    vi.spyOn(bridge, "getServiceLogs").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * `CodingAgentSetupView` composes **two** grids: `Agents` and, under "Bring your own LLM",
   * `byoAgents`. Before the appearance/coding-agent parity pass only the first was rendered, which is
   * why this test used to expect six cards in total.
   */
  it("offers every agent `build_agent_spec` can launch, then V1's BYO providers", async () => {
    await renderSettings();

    const labels = Array.from(
      screen.getByTestId("coding-agent-card").querySelectorAll("[data-testid^='coding-agent-']"),
    ).map((el) => el.textContent?.trim());

    expect(labels).toEqual([
      "Claude",
      "Copilot",
      "Codex",
      "Gemini",
      "Antigravity",
      "OpenCode",
      "Cursor",
      "Apple",
      "OpenAI",
      "Anthropic",
      "Berget AI",
    ]);
    expect(screen.getByTestId("coding-agent-claude")).toHaveAttribute("aria-pressed", "true");
    // The BYO block only asks for credentials once one of its cards is selected.
    expect(screen.queryByTestId("byo-credentials")).not.toBeInTheDocument();
  });

  it("writes a changed field to config.yaml via putConfig, never saveUiState", async () => {
    await renderSettings();

    fireEvent.click(screen.getByTestId("coding-agent-gemini"));
    await submitIn("coding-agent-card");

    expect(putConfig).toHaveBeenCalledWith("codingAgent", "gemini");
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(saveUiState).not.toHaveBeenCalled();
  });

  it("keeps each section's Save disabled until that section changes", async () => {
    await renderSettings("advanced");

    expect(saveIn("advanced-settings-card")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Job Timeout"), { target: { value: "45" } });
    expect(saveIn("advanced-settings-card")).toBeEnabled();

    // A change in one section does not arm another section's Save. Only one section is mounted at a
    // time now, so the other one is checked by navigating to it rather than by querying alongside.
    await gotoSection("coding-agent");
    expect(saveIn("coding-agent-card")).toBeDisabled();

    // The edit survives the round trip: the sidebar changes which view renders, not the form state.
    await gotoSection("advanced");
    expect(saveIn("advanced-settings-card")).toBeEnabled();
  });

  it("writes only the advanced keys that changed, and job timeout in minutes", async () => {
    await renderSettings("advanced");

    fireEvent.change(screen.getByLabelText("Job Timeout"), { target: { value: "45" } });
    await submitIn("advanced-settings-card");

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith("jobTimeout", 45);
  });

  it("surfaces a rejected save as an error, not a success message", async () => {
    putConfig.mockRejectedValue(new Error("Failed to update config: Merged config is invalid"));
    await renderSettings();

    // Counted from after the mount, because the model catalog card reads config on mount too.
    const readsAfterMount = getConfig.mock.calls.length;

    fireEvent.click(screen.getByTestId("coding-agent-gemini"));
    await submitIn("coding-agent-card");

    expect(
      screen.getByText(/Failed to update config: Merged config is invalid/),
    ).toBeInTheDocument();
    // A failed save does not re-read, so the operator's input survives the retry.
    expect(getConfig.mock.calls.length).toBe(readsAfterMount);
  });

  it("re-reads config from disk after a successful save", async () => {
    getConfig.mockResolvedValue({ ...baseConfig, maxConcurrentJobs: 8 });

    await renderSettings("advanced");

    fireEvent.change(screen.getByLabelText("Max Concurrent Jobs"), { target: { value: "8" } });
    await submitIn("advanced-settings-card");

    expect(screen.getByLabelText("Max Concurrent Jobs")).toHaveValue(8);
    expect(saveIn("advanced-settings-card")).toBeDisabled();
  });

  /**
   * `ConfigCommand.ApplyField` bounds every numeric key before any write, and
   * `ConfigService.ValidateSettings` re-checks them on load. V2 does neither: `PUT /api/config` only
   * checks that the merged file deserializes and there is no load-time clamp, so this screen is the
   * only gate an out-of-range value passes through.
   */
  it("refuses an out-of-bounds timeout with ParseBoundedInt's message and writes nothing", async () => {
    await renderSettings("advanced");

    fireEvent.change(screen.getByLabelText("Job Timeout"), { target: { value: "900" } });
    await submitIn("advanced-settings-card");

    expect(screen.getByText("jobTimeout must be between 1 and 480, got 900.")).toBeInTheDocument();
    expect(putConfig).not.toHaveBeenCalled();
  });

  it("refuses the whole section rather than persisting the half of it that is valid", async () => {
    await renderSettings("advanced");

    fireEvent.change(screen.getByLabelText("Max Concurrent Jobs"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Stale Output Timeout"), { target: { value: "90" } });
    await submitIn("advanced-settings-card");

    expect(
      screen.getByText("staleOutputTimeout must be between 1 and 60, got 90."),
    ).toBeInTheDocument();
    expect(putConfig).not.toHaveBeenCalled();
  });

  it("accepts a job timeout above V1's own input cap but inside the persisted bound", async () => {
    await renderSettings("advanced");

    fireEvent.change(screen.getByLabelText("Job Timeout"), { target: { value: "300" } });
    await submitIn("advanced-settings-card");

    expect(putConfig).toHaveBeenCalledWith("jobTimeout", 300);
  });

  it("shows what config.yaml already holds out of bounds rather than substituting a default", async () => {
    getConfig.mockResolvedValue({ ...baseConfig, jobTimeout: 0 });
    await renderSettings("advanced");

    expect(screen.getByLabelText("Job Timeout")).toHaveValue(0);
    expect(screen.getByTestId("advanced-out-of-bounds")).toHaveTextContent(
      "jobTimeout must be between 1 and 480, got 0.",
    );
  });

  /** `ConfigCommand.ValidateCodingAgent` refuses an unregistered agent and names the valid set. */
  it("names an unknown configured coding agent instead of just selecting nothing", async () => {
    getConfig.mockResolvedValue({ ...baseConfig, codingAgent: "aider" });
    await renderSettings();

    expect(screen.getByTestId("unknown-coding-agent")).toHaveTextContent(
      "Unknown coding agent 'aider'. Valid agents: antigravity, apple, claude, codex, copilot, cursor, gemini, opencode",
    );
    for (const agent of [
      "claude",
      "copilot",
      "codex",
      "gemini",
      "antigravity",
      "opencode",
      "cursor",
      "apple",
    ]) {
      expect(screen.getByTestId(`coding-agent-${agent}`)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("treats claudecode as claude, the way normalize_agent_name does", async () => {
    getConfig.mockResolvedValue({ ...baseConfig, codingAgent: "claudecode" });
    await renderSettings();

    expect(screen.queryByTestId("unknown-coding-agent")).not.toBeInTheDocument();
    expect(screen.getByTestId("coding-agent-claude")).toHaveAttribute("aria-pressed", "true");
  });

  it("saves the appearance mode on the click, under V1's themeMode key", async () => {
    await renderSettings("appearance");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Light" }));
    });

    expect(putConfig).toHaveBeenCalledWith("themeMode", "light");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  it("defaults the appearance mode to System when config.yaml does not mention it", async () => {
    getConfig.mockResolvedValue({ ...baseConfig, raw: {} });
    await renderSettings("appearance");

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * `CodingAgentSetupView`'s "Profile Models" block, writing the `codingAgents[].profiles` entries
   * `apply_profile` resolves. None of this was reachable from V2 before.
   */
  describe("agent profiles", () => {
    it("seeds the three tiers from codingAgents and shows the built-in tier default as a hint", async () => {
      getConfig.mockResolvedValue({
        ...baseConfig,
        raw: {
          ...baseConfig.raw,
          codingAgents: [
            { name: "claude", profiles: [{ name: "deep", model: "opus-4", effort: "high" }] },
          ],
        },
      });
      await renderSettings();

      expect(screen.getByLabelText("Deep")).toHaveValue("opus-4");
      // An unset tier is blank with the `default_profiles` value as its placeholder, rather than
      // looking like nothing at all will be passed.
      expect(screen.getByLabelText("Balanced")).toHaveValue("");
      expect(screen.getByLabelText("Balanced")).toHaveAttribute("placeholder", "claude-sonnet-5");
    });

    /**
     * V1 puts the model select and its effort select on one line:
     * `Layout.Horizontal() | model.Width(Size.Fraction(0.65f)) | effort.Width(Size.Fraction(0.35f))`,
     * and Ivy renders a horizontal layout `flex-wrap: nowrap`.
     *
     * V2 had `flex-wrap` with `basis-[65%]` and `basis-[35%]`. Those bases are exactly 100% of the
     * line *before* the `gap-2` between them, so the pair never fit and the effort select dropped to
     * its own row at every width - which is what the operator saw. Asserted structurally because
     * jsdom does no flex layout: the guard is that the two controls are siblings on a row that
     * cannot wrap, and that neither carries a percentage basis that would re-create the overflow.
     */
    it("keeps each tier's model and effort on one line, as V1's Layout.Horizontal does", async () => {
      await renderSettings();

      const model = screen.getByLabelText("Deep");
      const effort = screen.getAllByLabelText("Effort")[0];

      // By the weighted column itself rather than by a fixed number of `parentElement` hops: a
      // control is free to nest (a select wraps itself to anchor its chevron, as `NumberField`
      // does for its suffix), and the contract under test is the column, not the depth.
      const column = (control: HTMLElement) => control.closest("[class*='grow-']")!;
      const modelCol = column(model);
      const effortCol = column(effort);
      const row = modelCol.parentElement!;

      // Same row, in V1's order.
      expect(effortCol.parentElement).toBe(row);
      expect(row.className).toContain("flex");
      expect(row.className).not.toContain("flex-wrap");

      // 0.65 / 0.35 carried as grow weights, so the gap comes out of the shared space rather than
      // overflowing the line.
      expect(modelCol.className).toContain("grow-[65]");
      expect(effortCol.className).toContain("grow-[35]");
      expect(row.innerHTML).not.toMatch(/basis-\[\d+%\]/);
    });

    /**
     * `new Card(...)` in `CodingAgentSetupView`'s two grids is Ivy's `CardWidget` at its default
     * medium density, which pads a header-less card with `p-6` around a 32px logo and leaves the
     * label at the base font size - an 82px card. V2 drew `p-3`/`text-sm`, a 56px one.
     */
    it("pads the agent cards as V1's Card does, not a third shorter", async () => {
      await renderSettings();

      const card = screen.getByTestId("coding-agent-claude");
      // Token-wise rather than by substring: "gap-3" contains "p-3".
      const classes = card.className.split(/\s+/);
      expect(classes).toContain("p-6");
      expect(classes).not.toContain("p-3");
      expect(card.querySelector("span.text-base")).not.toBeNull();
    });

    it("writes the whole codingAgents array, since a config PUT replaces sequences", async () => {
      getConfig.mockResolvedValue({
        ...baseConfig,
        raw: {
          ...baseConfig.raw,
          codingAgents: [
            { name: "codex", arguments: "--yolo" },
            { name: "claude", profiles: [{ name: "deep", model: "opus", effort: "max" }] },
          ],
        },
      });
      await renderSettings();

      fireEvent.change(screen.getByLabelText("Quick"), { target: { value: "haiku-4" } });
      await submitIn("coding-agent-card");

      expect(putConfig).toHaveBeenCalledTimes(1);
      const [key, value] = putConfig.mock.calls[0] as [string, Record<string, unknown>[]];
      expect(key).toBe("codingAgents");
      // The untouched agent survives verbatim.
      expect(value[0]).toMatchObject({ name: "codex", arguments: "--yolo" });
      expect(value[1].profiles).toEqual([
        { name: "deep", model: "opus", effort: "max" },
        { name: "balanced", model: "", effort: "" },
        { name: "quick", model: "haiku-4", effort: "" },
      ]);
    });

    it("does not materialise a blank agent entry when only the selected agent changed", async () => {
      await renderSettings();

      fireEvent.click(screen.getByTestId("coding-agent-gemini"));
      await submitIn("coding-agent-card");

      // V1's Save always calls SaveProfiles; V2 must not, because an entry existing at all switches
      // `apply_profile` from "no opinion" to the `balanced` tier fallback.
      expect(putConfig).toHaveBeenCalledTimes(1);
      expect(putConfig).toHaveBeenCalledWith("codingAgent", "gemini");
    });

    it("parses KEY=value environment lines into the map AgentConfig stores", async () => {
      await renderSettings();

      fireEvent.change(screen.getByLabelText("Environment Variables"), {
        target: { value: "# comment\nANTHROPIC_API_KEY=sk-1\n\nFOO=bar" },
      });
      await submitIn("coding-agent-card");

      const [, value] = putConfig.mock.calls[0] as [string, Record<string, unknown>[]];
      expect(value[0].environmentVariables).toEqual({ ANTHROPIC_API_KEY: "sk-1", FOO: "bar" });
    });
  });

  /**
   * `PromptwaresSetupView` / `EditPromptwareDialogContent`, over the `promptwares` map.
   *
   * The `promptwares` key, the `promptwares-card` test id and the `promptware-*` control ids are all
   * left spelled the daemon's way on purpose - they are the persisted config key and DOM handles, not
   * things an operator reads. Only the visible strings say "agent".
   */
  describe("workflow agents", () => {
    /**
     * Radix's Select opens on a keypress here rather than a click: its trigger listens on
     * `pointerdown`, and jsdom's `click` carries none of the pointer state that handler reads, so a
     * clicked trigger never opens and the test only fails on the timeout.
     */
    const selectAgent = async (name: string) => {
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("combobox", { name: "Agent" }), { key: "ArrowDown" });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name }));
      });
    };

    afterEach(() => {
      resetPromptwareProgramTransport();
    });

    it("calls these agents, not promptwares, everywhere the operator can read it", async () => {
      setPromptwareProgramTransport(() => Promise.reject(new Error("not deployed")));
      await renderSettings("promptwares");

      const card = screen.getByTestId("promptwares-card");
      expect(card.querySelector("h2")).toHaveTextContent("Workflow Agents");
      expect(card.querySelector("label[for='promptware-select']")).toHaveTextContent("Agent");
      expect(card.querySelector("label[for='promptware-new-name']")).toHaveTextContent("Add Agent");
      expect(card.querySelector("#promptware-new-name")).toHaveAttribute(
        "placeholder",
        "Agent name (e.g. CreatePlan)...",
      );
      expect(card.textContent).not.toMatch(/promptware/i);
    });

    /**
     * The point of the pane: selecting an agent shows the prompt it actually runs, read from the
     * deployed `Program.md` rather than from config.
     */
    it("shows the selected agent's deployed prompt, and re-reads it when the selection changes", async () => {
      const readProgram = vi.fn((name: string) =>
        Promise.resolve({
          name,
          program: `# ${name}\n\nDo the ${name} thing.`,
          layer: "shipped" as const,
        }),
      );
      setPromptwareProgramTransport(readProgram);

      getConfig.mockResolvedValue({
        ...baseConfig,
        raw: {
          ...baseConfig.raw,
          promptwares: { ExecutePlan: { profile: "deep" }, CreatePlan: { profile: "quick" } },
        },
      });
      await renderSettings("promptwares");

      // `_default` is a fallback rather than an agent, so nothing is fetched for it.
      expect(readProgram).not.toHaveBeenCalled();
      expect(screen.getByTestId("promptware-program").textContent).toContain("no prompt");

      await selectAgent("ExecutePlan");

      expect(readProgram).toHaveBeenCalledWith("ExecutePlan");
      const pane = screen.getByTestId("promptware-program");
      expect(pane.textContent).toContain("Do the ExecutePlan thing.");
      // Rendered as markdown through the shared renderer, not dumped as raw text.
      expect(pane.querySelector(".pmv-markdown h1")).toHaveTextContent("ExecutePlan");
    });

    it("says why the pane is empty when nothing is deployed under that name", async () => {
      setPromptwareProgramTransport(() =>
        Promise.reject(new Error("No prompt deployed for agent 'CreatePlan'")),
      );
      await renderSettings("promptwares");

      await selectAgent("CreatePlan");

      expect(screen.getByTestId("promptware-program").textContent).toContain(
        "No prompt deployed for agent 'CreatePlan'",
      );
    });

    it("edits the reserved _default entry and merges it rather than replacing the map", async () => {
      getConfig.mockResolvedValue({
        ...baseConfig,
        raw: {
          ...baseConfig.raw,
          promptwares: {
            _default: { profile: "balanced", allowedTools: ["Write(src/**)"] },
            ExecutePlan: { profile: "deep" },
          },
        },
      });
      await renderSettings("promptwares");

      const allowed = screen
        .getByTestId("promptwares-card")
        .querySelector("#promptware-allowed-tools") as HTMLTextAreaElement;
      expect(allowed).toHaveValue("Write(src/**)");

      fireEvent.change(allowed, { target: { value: "Write(src/**)\nBash(pnpm *)" } });
      await act(async () => {
        fireEvent.click(saveIn("promptwares-card"));
      });

      expect(putConfig).toHaveBeenCalledWith("promptwares", {
        _default: {
          profile: "balanced",
          allowedTools: ["Write(src/**)", "Bash(pnpm *)"],
          deniedTools: [],
        },
      });
    });
  });

  /**
   * The seven flattened `AgentSecurityConfig` controls. `apply_security_settings` reads all of them on
   * every job launch, and none of them had a UI in V1.
   *
   * They belong to one project, so the structural pass moved them out of a top-level settings card
   * (which V1 has no row for) into the project's own screen, reached through the Projects row.
   */
  describe("project security", () => {
    const withProject = (project: Record<string, unknown>) => ({
      ...baseConfig,
      raw: { ...baseConfig.raw, projects: [{ name: "Tendril", ...project }] },
    });

    /** `SettingsApp.Build`: `TagProjects` with no projects falls back to `CodingAgentSetupView`. */
    it("falls back to the coding agent view when no project is configured", async () => {
      await renderSettings("projects");

      expect(screen.getByTestId("coding-agent-card")).toBeInTheDocument();
      expect(screen.queryByTestId("project-security")).not.toBeInTheDocument();
    });

    it("patches only the named project, by name, and leaves other keys alone", async () => {
      getConfig.mockResolvedValue(withProject({ repos: [{ path: "/src" }] }));
      await renderSettings("project:0");

      fireEvent.change(screen.getByLabelText("Allowed Terminal Commands"), {
        target: { value: "pnpm\ncargo" },
      });
      await act(async () => {
        fireEvent.click(saveIn("project-security"));
      });

      expect(putConfig).toHaveBeenCalledTimes(1);
      const [key, value] = putConfig.mock.calls[0] as [string, Record<string, unknown>[]];
      expect(key).toBe("projects");
      expect(value).toHaveLength(1);
      expect(value[0]).toMatchObject({
        name: "Tendril",
        allowedTerminalCommands: ["pnpm", "cargo"],
      });
      expect(value[0]).not.toHaveProperty("repos");
    });

    it("parses `Mode path` file rules and reports the effective policy", async () => {
      getConfig.mockResolvedValue(withProject({}));
      await renderSettings("project:0");

      fireEvent.change(screen.getByLabelText("File Permissions"), {
        target: { value: "Allow src/**\nDeny .env\nplain/path" },
      });
      await act(async () => {
        fireEvent.click(saveIn("project-security"));
      });

      const [, value] = putConfig.mock.calls[0] as [string, Record<string, unknown>[]];
      expect(value[0].filePermissions).toEqual([
        { path: "src/**", mode: "Allow" },
        { path: ".env", mode: "Deny" },
        // A line with no leading mode defaults to Allow, matching `default_allow_mode`.
        { path: "plain/path", mode: "Allow" },
      ]);
    });

    it("shows a preset's overrides as the effective value and locks the fields it wins over", async () => {
      getConfig.mockResolvedValue(
        withProject({ securityPreset: "Strict", sandboxMode: "Disabled" }),
      );
      await renderSettings("project:0");

      // `effective_sandbox_mode` forces Enabled under Strict even though the field says Disabled.
      expect(screen.getByTestId("project-security")).toHaveTextContent("Effective: Enabled.");
      expect(screen.getByTestId("project-security")).toHaveTextContent("Effective: Deny.");
      expect(screen.getByLabelText("Sandbox Mode")).toBeDisabled();
      expect(screen.getByLabelText("Outside File Access")).toBeDisabled();
      // The preset does not govern terminal confirmation.
      expect(screen.getByLabelText("Terminal Auto-Execution")).toBeEnabled();
    });

    it("tolerates the spaced enum spellings the .NET app writes", async () => {
      getConfig.mockResolvedValue(
        withProject({ sandboxMode: "Inherit General", terminalAutoExecution: "always ask" }),
      );
      await renderSettings("project:0");

      expect(screen.getByTestId("project-security")).toHaveTextContent("Effective: AlwaysAsk.");
      expect(saveIn("project-security")).toBeDisabled();
    });

    it("names the controls the configured agent's CLI ignores", async () => {
      getConfig.mockResolvedValue({ ...withProject({}), codingAgent: "opencode" });
      await renderSettings("project:0");

      expect(screen.getByTestId("project-security-enforcement")).toHaveTextContent(
        "OpenCode enforces: none of these controls.",
      );
    });

    it("reports full enforcement for Claude", async () => {
      getConfig.mockResolvedValue(withProject({}));
      await renderSettings("project:0");

      expect(screen.getByTestId("project-security-enforcement")).toHaveTextContent(
        "Claude enforces: sandbox mode, network access, terminal confirmation, file and command rules.",
      );
    });
  });

  it("saves the plan template on its own", async () => {
    await renderSettings("plans");

    fireEvent.change(screen.getByLabelText("Plan Template"), { target: { value: "## Goal" } });
    await submitIn("plans-settings-card");

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith("planTemplate", "## Goal");
  });
});
