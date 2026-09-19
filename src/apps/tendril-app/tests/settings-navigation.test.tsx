import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import { notificationsStore } from "../src/state/notificationsStore";
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

  /**
   * `TagSecurity` and `TagTunnel` select the same row and render the same view.
   *
   * The row's own behaviour lives in `security-tunneling-section.test.tsx`, which injects the bridge;
   * here the daemon is simply absent, which is the case that has to render rather than throw.
   */
  it("renders Security & Tunneling with V1's three blocks", async () => {
    await renderSettings(baseConfig, "tunnel");

    expect(screen.getByTestId("security-tunneling-card")).toBeInTheDocument();
    // `SecuritySetupView` plus both blocks of the `TunnelSetupView` it composes.
    expect(screen.getByTestId("session-protection")).toBeInTheDocument();
    expect(screen.getByTestId("full-tunnel")).toBeInTheDocument();
    expect(screen.getByTestId("share-tunnel")).toBeInTheDocument();
    expect(screen.getByTestId("settings-row-security")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps Daemon Diagnostics inside Advanced", async () => {
    await renderSettings();

    await click("settings-row-advanced");

    expect(screen.getByTestId("advanced-settings-card")).toBeInTheDocument();
    expect(screen.getByText("Daemon Diagnostics")).toBeInTheDocument();
  });

  /**
   * `ConfigYamlUiHelper.OpenOrNavigate`, taking the *navigate* arm rather than the shell-out.
   *
   * V2 used to hand the path to the OS, on the reasoning that V2 is always the desktop shell — which
   * made the app's own config button open TextEdit. `ConfigEditorView` is V1's `ConfigEditorApp`, so
   * the row now goes there. `openPath` is still spied on because the point of the assertion is that
   * nothing leaves the app any more.
   */
  it("opens the config editor from the action row without changing the selection", async () => {
    await renderSettings();

    await click("settings-row-open-config");

    expect(await screen.findByTestId("config-editor-view")).toBeInTheDocument();
    expect(openPath).not.toHaveBeenCalled();
    expect(screen.queryByTestId("coding-agent-card")).not.toBeInTheDocument();
    // V1 passes `false` for this row's selected, and the content pane it opens is a branch rather
    // than a section — so, exactly as while Add Project is open, no section row is highlighted.
    const selected = Array.from(
      screen.getByTestId("settings-sidebar").querySelectorAll('[aria-selected="true"]'),
    );
    expect(selected).toEqual([]);
    expect(screen.getByTestId("settings-row-open-config")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  /** And the way back: picking any section leaves the editor, exactly as it leaves Add Project. */
  it("leaves the config editor when a section is selected", async () => {
    await renderSettings();

    await click("settings-row-open-config");
    expect(await screen.findByTestId("config-editor-view")).toBeInTheDocument();

    await click("settings-row-advanced");

    expect(screen.queryByTestId("config-editor-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("advanced-settings-card")).toBeInTheDocument();
  });

  describe("the expandable Projects row", () => {
    const projects = [{ name: "Tendril" }, { name: "Ivy" }];

    /**
     * The Add Project blade's two daemon calls. They are ordered relative to each other, so the
     * spies record into one list rather than being asserted independently.
     */
    let order: string[];

    const mockAddProject = () => {
      order = [];
      const createProject = vi
        .spyOn(bridge, "createProject")
        .mockImplementation(async (request) => {
          order.push("createProject");
          // The daemon answers with the repositories as stored, which is what the blade hands to
          // `AddProject`. Nothing here clones, so they come back as sent.
          return { name: request.name, repos: (request.repos ?? []).map((path) => ({ path })) };
        });
      const startJob = vi.spyOn(bridge, "startJob").mockImplementation(async () => {
        order.push("startJob");
        return { jobId: "00042", status: "Started" };
      });
      // `jobsStore.startJob` refreshes the job list behind the create.
      vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
      const getConfig = vi.spyOn(bridge, "getConfig");
      getConfig.mockResolvedValue(withProjects(projects));
      return { createProject, startJob, getConfig };
    };

    const openAddProject = async () => {
      await click("settings-row-projects");
      await click("settings-row-add-project");
      expect(screen.getByTestId("add-project-card")).toBeInTheDocument();
    };

    /** Step 0: one repository, whose leaf seeds the name the way V1's picker does. */
    const fillNewProject = async () => {
      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: "/src/newthing" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Repository/ }));
      });
      expect(screen.getByLabelText("Name")).toHaveValue("newthing");
    };

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

    /**
     * `AddProjectBladeView`'s three steps. The blade used to stop after the first one and say in a
     * callout that the agent run was unreachable, which is what this used to assert - it closed the
     * blade and selected the project the instant Create Project was clicked. `AddProjectArgs` is a
     * real job type and `OnboardingWizard` had been starting it all along, so the blade now runs it
     * too, and the exit moved to the Finish button at the end of the harness step.
     */
    it("refuses an unrecognised repository path and sends a remote URL to be cloned", async () => {
      const { createProject } = mockAddProject();

      await renderSettings(withProjects(projects));
      await openAddProject();

      // V1 `ProjectRepoPickerView.AddAsync`'s refusal. Without it a bare word is a repository path.
      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: "newthing" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Repository/ }));
      });
      expect(screen.getByTestId("add-project-repo-error")).toHaveTextContent(
        "Invalid repository path.",
      );

      // A remote is accepted and its name seeds the project name, `.git` stripped, the same way a
      // local path's leaf does. The daemon clones it and stores the clone's path.
      const url = "https://github.com/Ivy-Interactive/newthing.git";
      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: url },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Repository/ }));
      });
      expect(screen.getByLabelText("Name")).toHaveValue("newthing");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      });
      expect(createProject).toHaveBeenCalledWith({ name: "newthing", repos: [url] });
    });

    it("creates the project, then hands the setup run to the AddProject job", async () => {
      const { createProject, startJob, getConfig } = mockAddProject();

      await renderSettings(withProjects(projects));
      await openAddProject();
      await fillNewProject();

      // The config the daemon reports after the create is what decides the new selection.
      getConfig.mockResolvedValue(withProjects([...projects, { name: "newthing" }]));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      });

      // V1's order, and the `AddProject` promptware's precondition: its first execution step is
      // "Run `tendril project list` to confirm the project exists", so the row has to be written
      // before the job that reads it starts.
      expect(order).toEqual(["createProject", "startJob"]);
      expect(createProject).toHaveBeenCalledWith({ name: "newthing", repos: ["/src/newthing"] });
      expect(startJob).toHaveBeenCalledWith({
        type: "AddProject",
        projectName: "newthing",
        repos: [{ path: "/src/newthing" }],
      });

      // The blade stays open on the agent step to watch the run, rather than popping on create.
      expect(screen.getByTestId("add-project-agent-step")).toBeInTheDocument();
      expect(screen.queryByTestId("project-settings-newthing")).not.toBeInTheDocument();
    });

    /** `ProjectCrudStepView`'s Next: the `Pop(this)` and the "added successfully" toast. */
    it("lands on the new project once the harness step finishes", async () => {
      const { getConfig } = mockAddProject();
      const notifySuccess = vi
        .spyOn(notificationsStore, "notifySuccess")
        .mockImplementation(() => undefined);

      await renderSettings(withProjects(projects));
      await openAddProject();
      await fillNewProject();

      getConfig.mockResolvedValue(withProjects([...projects, { name: "newthing" }]));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      });

      // Skip rather than Next: Next is gated on the run reaching a terminal status, and this test
      // is about the exit, not about the stream.
      await click("add-project-agent-skip");
      expect(screen.getByTestId("add-project-harness-step")).toBeInTheDocument();

      await click("add-project-finish");

      expect(screen.getByTestId("project-settings-newthing")).toBeInTheDocument();
      expect(screen.getByTestId("settings-row-project-2")).toHaveAttribute("aria-selected", "true");
      expect(notifySuccess).toHaveBeenCalledWith(
        "Success",
        "Project 'newthing' added successfully",
      );
    });

    /**
     * V1's Background button starts the same job as its Next; the only difference is that the blade
     * does not stay open to watch it. Its toast is the one `onBgJob` raises.
     */
    it("hands the run over and closes on Create in Background", async () => {
      const { startJob, getConfig } = mockAddProject();
      const notifySuccess = vi
        .spyOn(notificationsStore, "notifySuccess")
        .mockImplementation(() => undefined);

      await renderSettings(withProjects(projects));
      await openAddProject();
      await fillNewProject();

      getConfig.mockResolvedValue(withProjects([...projects, { name: "newthing" }]));
      await click("add-project-background");

      expect(startJob).toHaveBeenCalledWith({
        type: "AddProject",
        projectName: "newthing",
        repos: [{ path: "/src/newthing" }],
      });
      expect(screen.queryByTestId("add-project-agent-step")).not.toBeInTheDocument();
      expect(notifySuccess).toHaveBeenCalledWith(
        "Job Started",
        "Created background job for project 'newthing'",
      );
    });

    /**
     * V1 does not roll back a project whose promptware run failed to start, and V2 cannot: the only
     * project-removing call is `DELETE /api/projects/:name`, which the bridge does not expose. So a
     * failed hand-off goes forward to the harness step with the project registered, not back.
     */
    it("keeps the registered project when the setup job cannot start", async () => {
      const { createProject, getConfig } = mockAddProject();
      vi.spyOn(bridge, "startJob").mockRejectedValue(new Error("daemon is down"));

      await renderSettings(withProjects(projects));
      await openAddProject();
      await fillNewProject();

      getConfig.mockResolvedValue(withProjects([...projects, { name: "newthing" }]));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      });

      expect(createProject).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("add-project-harness-step")).toBeInTheDocument();
      expect(screen.getByText(/setup agent could not start/)).toBeInTheDocument();
    });

    /** The harness step reads what the run wrote back into config.yaml. */
    it("shows the verifications and review actions the run configured", async () => {
      const { getConfig } = mockAddProject();

      await renderSettings(withProjects(projects));
      await openAddProject();
      await fillNewProject();

      getConfig.mockResolvedValue(
        withProjects([
          ...projects,
          {
            name: "newthing",
            verifications: [{ name: "build", command: "pnpm build", required: true }],
            reviewActions: [{ name: "Run dev", command: "pnpm dev" }],
          },
        ]),
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      });
      await click("add-project-agent-skip");

      expect(screen.getByTestId("add-project-verifications")).toHaveTextContent("build");
      expect(screen.getByTestId("add-project-review-actions")).toHaveTextContent("pnpm dev");
      expect(screen.queryByTestId("add-project-harness-empty")).not.toBeInTheDocument();
    });

    /** A create that fails never reaches the agent step, and never starts a job. */
    it("stays on the input step when the create itself fails", async () => {
      const { startJob } = mockAddProject();
      vi.spyOn(bridge, "createProject").mockRejectedValue(new Error("name is taken"));

      await renderSettings(withProjects(projects));
      await openAddProject();
      await fillNewProject();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
      });

      expect(startJob).not.toHaveBeenCalled();
      expect(screen.getByTestId("add-project-card")).toBeInTheDocument();
      expect(screen.getByText(/Failed to create project/)).toBeInTheDocument();
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

/**
 * `SettingsApp.cs:120-121`: each expanded project sub-item carries the project's own colour.
 *
 *   var projColor = Enum.TryParse<Colors>(proj.Color, out var parsed)
 *       ? parsed : (config.GetProjectColor(proj.Name) ?? Colors.Slate);
 *   rows.Add(SidebarListRow.BuildSubItem(proj.Name, null, projColor, ...));
 *
 * and `SidebarListRow.BuildSubItem` renders it as `new Box().Background(color)
 * .BorderRadius(BorderRadius.Rounded).Width(Size.Units(3)).Height(Size.Units(3))`. The colour was set
 * in project settings and shown nowhere until this existed.
 */
describe("project colour in the settings sidebar", () => {
  const dot = (index: number) => screen.getByTestId(`settings-row-project-${index}-dot`);

  it("gives each project a dot in its configured colour", async () => {
    await renderSettings(
      withProjects([
        { name: "Tendril", color: "Emerald" },
        { name: "Ivy", color: "Purple" },
      ]),
    );

    await click("settings-row-projects");

    // The name resolves through the package's single `ivyColorVar`, so the token, not a hex literal.
    expect(dot(0)).toHaveAttribute("data-color", "Emerald");
    expect(dot(0).style.backgroundColor).toBe("var(--emerald, currentColor)");
    expect(dot(1)).toHaveAttribute("data-color", "Purple");
    expect(dot(1).style.backgroundColor).toBe("var(--purple, currentColor)");
  });

  /** V1's `?? Colors.Slate`: no colour configured is a neutral marker, not an invented one. */
  it("falls back to Slate for a project with no colour", async () => {
    await renderSettings(withProjects([{ name: "Tendril" }, { name: "Ivy", color: "   " }]));

    await click("settings-row-projects");

    expect(dot(0)).toHaveAttribute("data-color", "Slate");
    expect(dot(1)).toHaveAttribute("data-color", "Slate");
  });

  /**
   * `Size.Units(3)` with `BorderRadius.Rounded`, which `styles.ts` resolves to 0.5rem — now spelled as
   * `rounded-box`, the utility for `--radius-boxes`, whose value is that same 0.5rem.
   */
  it("matches V1's 0.75rem swatch rather than inventing a size", async () => {
    await renderSettings(withProjects([{ name: "Tendril", color: "Blue" }]));

    await click("settings-row-projects");

    expect(dot(0)).toHaveClass("size-3", "rounded-box", "shrink-0");
  });

  /** `BuildSubItem` renders the icon *or* the colour box: "Add Project" has an icon, so no dot. */
  it("gives the Add Project row an icon rather than a colour dot", async () => {
    await renderSettings(withProjects([{ name: "Tendril", color: "Blue" }]));

    await click("settings-row-projects");

    expect(screen.getByTestId("settings-row-add-project")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-row-add-project-dot")).not.toBeInTheDocument();
  });
});
