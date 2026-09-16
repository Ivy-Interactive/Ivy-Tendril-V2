import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * `Apps/Settings/SettingsApp.cs`'s nested sidebar: its rows, in its order, with the expandable
 * Projects row and the "Open config.yaml" action row. Before the structural pass V2 rendered every
 * section at once as a flat stack of cards, with no navigation and with two rows V1 does not have.
 */

const openPath = vi.fn((_path: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (path: string) => openPath(path),
  openUrl: vi.fn(),
}));

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
  capabilities: ["plans"],
  message: "Online",
};

const withProjects = (
  projects: Record<string, unknown>[],
  extraRaw: Record<string, unknown> = {},
): TendrilConfig => ({
  ...baseConfig,
  raw: { ...baseConfig.raw, ...extraRaw, projects },
});

async function renderSettings(config: TendrilConfig = baseConfig, section?: string) {
  vi.spyOn(bridge, "getConfig").mockResolvedValue(config);
  await act(async () => {
    render(
      <SettingsView serviceInfo={serviceInfo} onRefreshHealth={vi.fn()} initialSection={section} />,
    );
  });
}

const click = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const rowLabels = () =>
  Array.from(screen.getByTestId("settings-sidebar").querySelectorAll("button")).map((button) =>
    button.textContent?.trim(),
  );

describe("SettingsView sidebar", () => {
  beforeEach(() => {
    vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
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
    openPath.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `SettingsApp.Build`'s `sections` plus its `rows`, in order, with Team Vault gated on `isBeta`. */
  it("shows V1's rows in V1's order, with Team Vault gated on beta", async () => {
    await renderSettings();

    expect(rowLabels()).toEqual([
      "Coding Agent",
      "Plans",
      "Appearance",
      "Projects",
      "Promptwares",
      "Levels",
      "Notifications",
      "Security & Tunneling",
      "Advanced",
      "Newsletter",
      "Open config.yaml",
    ]);
  });

  it("adds the Team Vault row once beta is opted in", async () => {
    await renderSettings({ ...baseConfig, raw: { ...baseConfig.raw, beta: true } });

    expect(rowLabels()).toEqual([
      "Coding Agent",
      "Plans",
      "Appearance",
      "Projects",
      "Team Vault",
      "Promptwares",
      "Levels",
      "Notifications",
      "Security & Tunneling",
      "Advanced",
      "Newsletter",
      "Open config.yaml",
    ]);
  });

  /**
   * The two rows V2 had and V1 does not. Project Security is per-project configuration in V1, reached
   * through the Projects row, and Daemon Diagnostics has no V1 counterpart so it belongs inside a row
   * V1 does have rather than as its own.
   */
  it("has no top-level Project Security or Daemon Diagnostics row", async () => {
    await renderSettings();

    expect(rowLabels()).not.toContain("Project Security");
    expect(rowLabels()).not.toContain("Daemon Diagnostics");
  });

  it("opens on Coding Agent, the way `args?.Section ?? TagCodingAgent` does", async () => {
    await renderSettings();

    expect(screen.getByTestId("coding-agent-card")).toBeInTheDocument();
    expect(screen.getByTestId("settings-row-coding-agent")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByTestId("plans-settings-card")).not.toBeInTheDocument();
  });

  it("swaps the content area when a section is selected, rather than scrolling to it", async () => {
    await renderSettings();

    await click("settings-row-plans");

    expect(screen.getByTestId("plans-settings-card")).toBeInTheDocument();
    expect(screen.queryByTestId("coding-agent-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-row-plans")).toHaveAttribute("aria-selected", "true");
  });

  it("renders the Levels row's own view, and says it changes nothing yet", async () => {
    await renderSettings({
      ...baseConfig,
      raw: { ...baseConfig.raw, levels: [{ name: "Bug", color: "Red" }] },
    });

    await click("settings-row-levels");

    expect(screen.getByTestId("levels-table")).toHaveTextContent("Bug");
    expect(screen.getByTestId("levels-no-effect")).toBeInTheDocument();
  });

  /** `TagSecurity` and `TagTunnel` select the same row and render the same view. */
  it("renders Security & Tunneling, and reports what is not wired", async () => {
    await renderSettings(baseConfig, "tunnel");

    expect(screen.getByTestId("security-tunneling-card")).toBeInTheDocument();
    expect(screen.getByTestId("security-not-wired")).toBeInTheDocument();
    expect(screen.getByTestId("settings-row-security")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps Daemon Diagnostics inside Advanced", async () => {
    await renderSettings();

    await click("settings-row-advanced");

    expect(screen.getByTestId("advanced-settings-card")).toBeInTheDocument();
    expect(screen.getByText("Daemon Diagnostics")).toBeInTheDocument();
  });

  /** `ConfigYamlUiHelper.OpenOrNavigate`: on the desktop shell it opens the file itself. */
  it("opens config.yaml from the action row without changing the selection", async () => {
    await renderSettings();

    await click("settings-row-open-config");

    expect(openPath).toHaveBeenCalledWith("/home/user/.tendril/config.yaml");
    // The action row never becomes the selection, so Coding Agent is still showing.
    expect(screen.getByTestId("coding-agent-card")).toBeInTheDocument();
    expect(screen.getByTestId("settings-row-open-config")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  describe("the expandable Projects row", () => {
    const projects = [{ name: "Tendril" }, { name: "Ivy" }];

    it("is collapsed to start, with no project rows", async () => {
      await renderSettings(withProjects(projects));

      expect(screen.getByTestId("settings-row-projects")).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByTestId("settings-row-project-0")).not.toBeInTheDocument();
      expect(screen.queryByTestId("settings-row-add-project")).not.toBeInTheDocument();
    });

    it("reveals a sub-item per project plus Add Project, and lands on the first project", async () => {
      await renderSettings(withProjects(projects));

      await click("settings-row-projects");

      expect(screen.getByTestId("settings-row-projects")).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("settings-row-project-0")).toHaveTextContent("Tendril");
      expect(screen.getByTestId("settings-row-project-1")).toHaveTextContent("Ivy");
      expect(screen.getByTestId("settings-row-add-project")).toHaveTextContent("Add Project");
      // Expanding jumps to the first project, so the content area is not left on Coding Agent.
      expect(screen.getByTestId("project-settings-Tendril")).toBeInTheDocument();
    });

    it("lands on the project a sub-item names", async () => {
      await renderSettings(withProjects(projects));

      await click("settings-row-projects");
      await click("settings-row-project-1");

      expect(screen.getByTestId("project-settings-Ivy")).toBeInTheDocument();
      expect(screen.queryByTestId("project-settings-Tendril")).not.toBeInTheDocument();
      expect(screen.getByTestId("settings-row-project-1")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("settings-row-project-0")).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });

    /** `SettingsApp.Build`: `project:<n>` is the tag, so a deep link opens straight on that project. */
    it("opens straight on a project when initialSection names one", async () => {
      await renderSettings(withProjects(projects), "project:1");

      expect(screen.getByTestId("project-settings-Ivy")).toBeInTheDocument();
      expect(screen.getByTestId("settings-row-projects")).toHaveAttribute("aria-expanded", "true");
    });

    /** An index that does not resolve falls back to the first project, as V1's `TryParse` guard does. */
    it("falls back to the first project when the index does not resolve", async () => {
      await renderSettings(withProjects(projects), "project:7");

      expect(screen.getByTestId("project-settings-Tendril")).toBeInTheDocument();
    });

    it("expands without moving the selection when a project is already selected", async () => {
      await renderSettings(withProjects(projects), "project:1");

      await click("settings-row-projects");
      await click("settings-row-projects");

      expect(screen.getByTestId("project-settings-Ivy")).toBeInTheDocument();
    });

    it("creates a project from the Add Project sub-item and selects it", async () => {
      const createProject = vi.spyOn(bridge, "createProject").mockResolvedValue(undefined);
      const getConfig = vi.spyOn(bridge, "getConfig");
      getConfig.mockResolvedValue(withProjects(projects));

      await renderSettings(withProjects(projects));
      await click("settings-row-projects");
      await click("settings-row-add-project");

      expect(screen.getByTestId("add-project-card")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: "/src/newthing" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Repository/ }));
      });
      // The name is seeded from the repository's leaf, the way V1's picker seeds a blank name.
      expect(screen.getByLabelText("Name")).toHaveValue("newthing");

      // The config the daemon reports after the create is what decides the new selection.
      getConfig.mockResolvedValue(withProjects([...projects, { name: "newthing" }]));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      });

      expect(createProject).toHaveBeenCalledWith({ name: "newthing", repos: ["/src/newthing"] });
      expect(screen.getByTestId("project-settings-newthing")).toBeInTheDocument();
      expect(screen.getByTestId("settings-row-project-2")).toHaveAttribute("aria-selected", "true");
    });

    it("refuses a duplicate project name, case-insensitively", async () => {
      await renderSettings(withProjects(projects));
      await click("settings-row-projects");
      await click("settings-row-add-project");

      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "tendril" } });

      expect(screen.getByText("A project named 'tendril' already exists.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create Project" })).toBeDisabled();
    });
  });
});
