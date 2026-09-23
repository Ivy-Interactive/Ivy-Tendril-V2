import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import { notificationsStore } from "../src/state/notificationsStore";
import {
  applyVerificationChange,
  orderForDisplay,
  reorderProjectVerifications,
  type ProjectVerificationRef,
  type VerificationDef,
} from "../src/views/settings/projectConfig";
import { confirmsProjectName } from "../src/views/dialogs/DeleteProjectDialog";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * `Apps/Settings/ProjectDetailView.cs` and the editors in `Apps/Settings/Blades/`. None of this
 * existed in V2: repos and base branches, verifications and their run order, review actions, MCP
 * servers, skills, ports, env files, colour, rename and the Danger Zone had no counterpart at all.
 *
 * Every write goes out as the one-element `projects` array `merge_projects_by_name` matches by name,
 * carrying only the keys that changed. Arrays inside a project replace wholesale, which is what makes
 * a deletion possible; `ports` is a mapping and deep-merges, which is what makes one impossible.
 *
 * Renaming and deleting the project itself are the two things that route cannot express at all - a
 * renamed entry matches nothing and is appended beside the original, and omission is not deletion -
 * so they go out as `PUT /api/projects/:name` and `DELETE /api/projects/:name` instead, and the tests
 * for them assert on the bridge call rather than on a config patch.
 *
 * The Danger Zone is two actions rather than one because "Delete Project" used to mean neither of
 * them: it called the detach route, which touches no file on disk. Remove Project is that route
 * under its real name; Delete Project is `DELETE /api/projects/:name/data`, which deletes, and is
 * gated on typing the project's name.
 */

// The colour field is a Radix popover, which is slow to open under jsdom - the same two knobs
// `chat-header.test.tsx` raises, for the same reason.
vi.setConfig({ testTimeout: 120_000 });

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(() => Promise.resolve()),
  openUrl: vi.fn(),
}));

const serviceInfo: ServiceInfo = {
  state: "Connected",
  tendrilHome: "/home/user/.tendril",
  port: 5010,
  host: "127.0.0.1",
  capabilities: ["plans"],
  message: "Online",
};

const configWith = (
  project: Record<string, unknown>,
  extraRaw: Record<string, unknown> = {},
): TendrilConfig => ({
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
  raw: {
    staleOutputTimeout: 10,
    beta: false,
    themeMode: "system",
    ...extraRaw,
    projects: [{ name: "Tendril", ...project }],
  },
});

/** {@link configWith} for the two tests that need a second project to collide with. */
const withProjects = (projects: Record<string, unknown>[]): TendrilConfig => ({
  ...configWith({}),
  raw: { ...configWith({}).raw, projects },
});

async function renderProject(config: TendrilConfig) {
  vi.spyOn(bridge, "getConfig").mockResolvedValue(config);
  await act(async () => {
    render(
      <SettingsView
        serviceInfo={serviceInfo}
        onRefreshHealth={vi.fn()}
        initialSection="project:0"
      />,
    );
  });
}

const clickButton = async (name: string | RegExp, index = 0) => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name })[index]);
  });
};

/**
 * Answers the removal confirm every destructive row action on this screen now opens, per Framework's
 * "never delete on single click" (`useRemovalConfirm`).
 */
const confirmRemoval = async () => {
  const dialog = await screen.findByTestId("settings-remove-dialog");
  await act(async () => {
    fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
  });
};

/** The single `projects` payload the last `putConfig` sent. */
const lastProjectPatch = (putConfig: ReturnType<typeof vi.spyOn>) => {
  const calls = putConfig.mock.calls as [string, Record<string, unknown>[]][];
  const last = calls[calls.length - 1];
  expect(last[0]).toBe("projects");
  expect(last[1]).toHaveLength(1);
  return last[1][0];
};

describe("project configuration", () => {
  let putConfig: ReturnType<typeof vi.spyOn>;
  let notifySuccess: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
    vi.spyOn(bridge, "getServiceLogs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjectMemory").mockResolvedValue([]);
    notifySuccess = vi
      .spyOn(notificationsStore, "notifySuccess")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `ProjectDetailView`'s ten blocks, in its order. */
  it("renders the project's blocks in ProjectDetailView's order", async () => {
    await renderProject(configWith({}));

    // The trailing count is a sibling span inside the heading, so it is stripped here.
    const headings = Array.from(document.querySelectorAll("h3")).map((h) =>
      h.textContent?.replace(/\d+$/, "").trim(),
    );
    expect(headings).toEqual([
      "Basic",
      "Repositories",
      "Review Actions",
      "Verifications",
      "Ports",
      "Environment Files",
      "Security",
      "Danger Zone",
    ]);
  });

  it("adds the three beta-gated blocks V1 gates the same way", async () => {
    await renderProject(configWith({}, { beta: true }));

    // The trailing count is a sibling span inside the heading, so it is stripped here.
    const headings = Array.from(document.querySelectorAll("h3")).map((h) =>
      h.textContent?.replace(/\d+$/, "").trim(),
    );
    expect(headings).toContain("Agent Behavior");
    expect(headings).toContain("Local Permissions");
    expect(headings).toContain("Customizations");
  });

  describe("repositories", () => {
    it("saves a base branch as the whole repos list, since a sequence replaces", async () => {
      await renderProject(configWith({ repos: [{ path: "/a" }, { path: "/b" }] }));

      await act(async () => {
        fireEvent.change(screen.getByLabelText("Base branch for /a"), {
          target: { value: "develop" },
        });
      });

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        repos: [{ path: "/a", baseBranch: "develop" }, { path: "/b" }],
      });
    });

    it("adds a repository, and refuses a duplicate path", async () => {
      await renderProject(configWith({ repos: [{ path: "/a" }] }));

      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: "/a" },
      });
      await clickButton(/Add Repository/);
      expect(putConfig).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: "/b" },
      });
      await clickButton(/Add Repository/);

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        repos: [{ path: "/a" }, { path: "/b" }],
      });
    });

    /**
     * The half of this that refuses an unrecognised path is V1 `ProjectRepoPickerView.AddAsync`'s
     * own guard. The other half is a regression test for a credential leak: a remote used to be
     * added by writing the whole `repos` list back through `PUT /api/config`, which stores what it
     * is handed, so `https://user:token@host/o/r.git` was persisted to `config.yaml` with the token
     * in it - and the entry was useless besides, because `resolve_working_directory` only accepts a
     * repo path that is a directory. `POST /api/projects/:name/repos` is the only route that clones,
     * so that is where a remote has to go, and the path that comes back is the clone's.
     */
    it("clones a remote through the repos route, and refuses a path it cannot recognise", async () => {
      const addProjectRepo = vi
        .spyOn(bridge, "addProjectRepo")
        .mockResolvedValue({ path: "/home/user/.tendril/Projects/Tendril/Repos/ivy/widgets" });
      await renderProject(configWith({ repos: [{ path: "/a" }] }));

      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: "tendril" },
      });
      await clickButton(/Add Repository/);
      expect(screen.getByTestId("project-repo-error")).toHaveTextContent(
        "Invalid repository path.",
      );
      expect(putConfig).not.toHaveBeenCalled();
      expect(addProjectRepo).not.toHaveBeenCalled();

      // The re-read that follows the clone is what puts the stored path on screen, so the config the
      // daemon answers with has to be the post-clone one.
      (bridge.getConfig as ReturnType<typeof vi.spyOn>).mockResolvedValue(
        configWith({
          repos: [
            { path: "/a" },
            { path: "/home/user/.tendril/Projects/Tendril/Repos/ivy/widgets" },
          ],
        }),
      );

      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: "https://GitHub.com/Ivy-Interactive/Ivy-Tendril-V2.git" },
      });
      await clickButton(/Add Repository/);

      // Normalized: V1 lowercases a remote's scheme and host so two spellings dedupe.
      expect(addProjectRepo).toHaveBeenCalledWith(
        "Tendril",
        "https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git",
      );
      // Nothing about the remote reaches `PUT /api/config` - that write is what used to store the
      // URL, credentials included.
      expect(putConfig).not.toHaveBeenCalled();

      // The row names the clone directory. The URL appears nowhere on the screen, which is the
      // property that matters when it is a URL with a token in it.
      const row = await screen.findByLabelText(
        "Base branch for /home/user/.tendril/Projects/Tendril/Repos/ivy/widgets",
      );
      expect(row).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("Ivy-Tendril-V2.git");
    });

    /** A local path has nothing to clone, so it stays the `PUT /api/config` write V1 makes too. */
    it("adds a local path through the config write, without touching the clone route", async () => {
      const addProjectRepo = vi.spyOn(bridge, "addProjectRepo");
      await renderProject(configWith({ repos: [{ path: "/a" }] }));

      fireEvent.change(screen.getByLabelText("Repository URL or Local Path"), {
        target: { value: "/b" },
      });
      await clickButton(/Add Repository/);

      expect(addProjectRepo).not.toHaveBeenCalled();
      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        repos: [{ path: "/a" }, { path: "/b" }],
      });
    });

    it("removes a repository, once the removal is confirmed", async () => {
      await renderProject(configWith({ repos: [{ path: "/a" }, { path: "/b" }] }));

      await clickButton("Remove /a");
      // The click opens the confirm and writes nothing on its own.
      expect(putConfig).not.toHaveBeenCalled();

      await confirmRemoval();

      expect(lastProjectPatch(putConfig)).toEqual({ name: "Tendril", repos: [{ path: "/b" }] });
    });

    it("keeps the repository when the removal is cancelled", async () => {
      await renderProject(configWith({ repos: [{ path: "/a" }, { path: "/b" }] }));

      await clickButton("Remove /a");
      const dialog = await screen.findByTestId("settings-remove-dialog");
      await act(async () => {
        fireEvent.click(within(dialog).getByTestId("dialog-cancel"));
      });

      expect(putConfig).not.toHaveBeenCalled();
    });
  });

  describe("verifications", () => {
    const withRegistry = (project: Record<string, unknown>) =>
      configWith(project, {
        verifications: [
          { name: "Build", prompt: "build it" },
          { name: "Tests", prompt: "test it" },
        ],
      });

    /**
     * `SortableVerificationList` is exported from the components package and, before this, imported by
     * nothing - which is exactly why verification run order had no UI anywhere in V2.
     */
    it("lists the registry with the project's own entries first, in the project's order", async () => {
      await renderProject(withRegistry({ verifications: [{ name: "Tests", required: true }] }));

      const names = Array.from(document.querySelectorAll(".svl-name")).map((n) => n.textContent);
      expect(names).toEqual(["Tests", "Build"]);
      expect(screen.getByRole("checkbox", { name: "Tests" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Build" })).not.toBeChecked();
    });

    it("enables a verification by appending it to the project's list", async () => {
      await renderProject(withRegistry({ verifications: [{ name: "Tests", required: true }] }));

      await act(async () => {
        fireEvent.click(screen.getByRole("checkbox", { name: "Build" }));
      });

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        verifications: [
          { name: "Tests", required: true },
          { name: "Build", required: false },
        ],
      });
    });

    it("disables a verification by dropping it", async () => {
      await renderProject(withRegistry({ verifications: [{ name: "Tests", required: true }] }));

      await act(async () => {
        fireEvent.click(screen.getByRole("checkbox", { name: "Tests" }));
      });

      expect(lastProjectPatch(putConfig)).toEqual({ name: "Tendril", verifications: [] });
    });

    it("says there is nothing to enable when the registry is empty", async () => {
      await renderProject(configWith({}));

      expect(screen.getByTestId("project-verifications")).toHaveTextContent(
        "No verifications are defined in config.yaml",
      );
    });

    /** `EditVerificationBladeView`: it appends to the registry, then enables the new entry. */
    it("adds a verification to the registry and enables it on the project", async () => {
      await renderProject(withRegistry({ verifications: [] }));

      await clickButton(/Add Verification/);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Lint" } });
      fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "lint it" } });
      await clickButton("Add");

      expect(putConfig).toHaveBeenNthCalledWith(1, "verifications", [
        { name: "Build", prompt: "build it" },
        { name: "Tests", prompt: "test it" },
        { name: "Lint", prompt: "lint it" },
      ]);
      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        verifications: [{ name: "Lint", required: false }],
      });
    });

    it("refuses a verification name the registry already holds", async () => {
      await renderProject(withRegistry({}));

      await clickButton(/Add Verification/);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "build" } });

      expect(screen.getByText("A verification named 'build' already exists.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    });
  });

  describe("review actions", () => {
    it("adds one through a blade, requiring a name and a command", async () => {
      await renderProject(configWith({ reviewActions: [{ name: "Existing", command: "x" }] }));

      await clickButton(/Add Review Action/);
      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Serve" } });
      fireEvent.change(screen.getByLabelText("Command"), { target: { value: "pnpm dev" } });
      fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "${hasChanges}" } });
      await clickButton("Add");

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        reviewActions: [
          { name: "Existing", condition: "", command: "x", paths: [] },
          { name: "Serve", condition: "${hasChanges}", command: "pnpm dev", paths: [] },
        ],
      });
    });

    it("deletes one from its row", async () => {
      await renderProject(
        configWith({
          reviewActions: [
            { name: "A", command: "a" },
            { name: "B", command: "b" },
          ],
        }),
      );

      await clickButton("Delete");
      expect(putConfig).not.toHaveBeenCalled();
      await confirmRemoval();

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        reviewActions: [{ name: "B", condition: "", command: "b", paths: [] }],
      });
    });
  });

  describe("ports", () => {
    it("adds a port and keeps the existing ones, since a mapping merges", async () => {
      await renderProject(
        configWith({ ports: { backend: { defaultPort: 5000, description: "api" } } }),
      );

      await clickButton(/Add Port/);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "frontend" } });
      fireEvent.change(screen.getByLabelText("Default Port"), { target: { value: "3000" } });
      await clickButton("Add");

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        ports: {
          backend: { defaultPort: 5000, description: "api" },
          frontend: { defaultPort: 3000, description: "" },
        },
      });
    });

    it("refuses a port outside 1-65535", async () => {
      await renderProject(configWith({}));

      await clickButton(/Add Port/);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "web" } });
      fireEvent.change(screen.getByLabelText("Default Port"), { target: { value: "70000" } });

      expect(screen.getByText("Default Port must be between 1 and 65535.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    });

    /**
     * `PUT /api/config` deep-merges mappings, so a removed or renamed port key survives. V1 rewrites
     * the whole file and can do both; this says so rather than offering a delete that does nothing.
     */
    it("offers no delete and says why a rename is refused", async () => {
      await renderProject(
        configWith({ ports: { backend: { defaultPort: 5000, description: "api" } } }),
      );

      expect(screen.getByTestId("project-ports-merge-note")).toBeInTheDocument();
      const table = screen.getByTestId("project-ports-table");
      const labels = Array.from(table.querySelectorAll("button")).map((b) =>
        b.getAttribute("aria-label"),
      );
      expect(labels).toContain("Edit");
      expect(labels).not.toContain("Delete");

      await clickButton("Edit");
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
      // The blade's own Save, which is the last one in the document.
      expect(screen.getAllByRole("button", { name: "Save" }).at(-1)).toBeDisabled();
      // The refusal is shown on the field, not only in the section-level note.
      expect(screen.getAllByText(/deep-merges mappings/)).toHaveLength(2);
    });
  });

  describe("environment files", () => {
    it("adds one with KEY=VALUE overrides", async () => {
      await renderProject(configWith({}));

      await clickButton(/Add Environment File/);
      fireEvent.change(screen.getByLabelText("Path"), { target: { value: "apps/web/.env" } });
      fireEvent.change(screen.getByLabelText("Template"), { target: { value: ".env.example" } });
      fireEvent.change(screen.getByLabelText("Overrides"), {
        target: { value: "# comment\nPORT=${ports.backend}\n\nBAD" },
      });
      await clickButton("Add");

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        envFiles: [
          {
            path: "apps/web/.env",
            template: ".env.example",
            overrides: { PORT: "${ports.backend}" },
          },
        ],
      });
    });

    it("deletes one, because envFiles is a sequence and a sequence replaces", async () => {
      await renderProject(configWith({ envFiles: [{ path: ".env" }, { path: "apps/web/.env" }] }));

      const table = screen.getByTestId("project-env-files-table");
      const del = Array.from(table.querySelectorAll("button")).find(
        (b) => b.getAttribute("aria-label") === "Delete",
      );
      await act(async () => {
        fireEvent.click(del!);
      });
      expect(putConfig).not.toHaveBeenCalled();
      await confirmRemoval();

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        envFiles: [{ path: "apps/web/.env", overrides: {} }],
      });
    });
  });

  describe("MCP servers and skills", () => {
    it("adds an MCP server with whitespace-split arguments", async () => {
      await renderProject(configWith({}, { beta: true }));

      await clickButton(/Add MCP Server/);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "sqlite" } });
      fireEvent.change(screen.getByLabelText("Command"), { target: { value: "npx" } });
      fireEvent.change(screen.getByLabelText("Arguments"), {
        target: { value: "-y @modelcontextprotocol/server-sqlite" },
      });
      fireEvent.change(screen.getByLabelText("Environment Variables"), {
        target: { value: "DB=./x.db" },
      });
      await clickButton("Add");

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        mcpServers: [
          {
            name: "sqlite",
            command: "npx",
            arguments: ["-y", "@modelcontextprotocol/server-sqlite"],
            environment: { DB: "./x.db" },
            disabled: false,
          },
        ],
      });
    });

    it("adds a custom skill", async () => {
      await renderProject(configWith({}, { beta: true }));

      await clickButton(/Add Custom Skill/);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "code-review" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "reviews" } });
      await clickButton("Add");

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        skills: [{ name: "code-review", description: "reviews", disabled: false }],
      });
    });

    /** `ProjectMemoryTableView`: the `Memory/*.md` files, read through the daemon's memory route. */
    it("lists the project's memory files with their snippets", async () => {
      const list = vi
        .spyOn(bridge, "listProjectMemory")
        .mockResolvedValue([
          { fileName: "stack.md", snippet: "Stack — Rust daemon", sizeBytes: 42 },
        ]);
      await renderProject(configWith({}, { beta: true }));

      expect(list).toHaveBeenCalledWith("Tendril");
      const table = await screen.findByTestId("project-memory-table");
      expect(within(table).getByText("stack.md")).toBeInTheDocument();
      expect(within(table).getByText("Stack — Rust daemon")).toBeInTheDocument();
    });

    it("deletes a memory file only once the removal is confirmed", async () => {
      vi.spyOn(bridge, "listProjectMemory").mockResolvedValue([
        { fileName: "stack.md", snippet: "Stack", sizeBytes: 5 },
      ]);
      const remove = vi.spyOn(bridge, "deleteProjectMemory").mockResolvedValue(undefined);
      await renderProject(configWith({}, { beta: true }));

      const table = await screen.findByTestId("project-memory-table");
      const del = Array.from(table.querySelectorAll("button")).find(
        (b) => b.getAttribute("aria-label") === "Delete",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(del);
      });
      expect(remove).not.toHaveBeenCalled();

      const dialog = screen.getByTestId("settings-remove-dialog");
      expect(dialog.textContent).toContain("Remove memory file stack.md from this project?");
      await act(async () => {
        fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
      });
      expect(remove).toHaveBeenCalledWith("Tendril", "stack.md");
    });
  });

  describe("basic details and the danger zone", () => {
    /**
     * The colour is picked from V1's swatch grid rather than typed - see
     * `tests/project-color-swatch.test.tsx` for the palette itself. What this asserts is that the
     * pick reaches the same `projects` patch the context does, in one save.
     */
    it("saves the colour and context together", async () => {
      await renderProject(configWith({ color: "Slate", context: "old" }));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Color" }));
      });
      const palette = await screen.findByRole("group", { name: "Colors" }, { timeout: 60_000 });
      await act(async () => {
        fireEvent.click(within(palette).getByRole("button", { name: "Emerald" }));
      });
      fireEvent.change(screen.getByLabelText("Context"), { target: { value: "new" } });
      await clickButton("Save");

      expect(lastProjectPatch(putConfig)).toEqual({
        name: "Tendril",
        color: "Emerald",
        context: "new",
      });
    });

    /**
     * `ProjectDetailView.nameHeader`. Neither of these is a `putConfig` call, and that is the point:
     * a rename over `PUT /api/config` appends a second project beside the original, and omission is
     * not deletion, so each takes its own daemon route. What the tests assert on is therefore the
     * bridge call, and that no config patch went out beside it.
     */
    describe("rename", () => {
      const openRename = async () => {
        await clickButton("Rename Project");
        return screen.getByTestId("project-name-input");
      };

      it("renames over the project route, not through a config patch", async () => {
        const rename = vi.spyOn(bridge, "renameProject").mockResolvedValue("Tendril2");
        await renderProject(configWith({}));

        const input = await openRename();
        fireEvent.change(input, { target: { value: "Tendril2" } });
        await clickButton("Confirm rename");

        expect(rename).toHaveBeenCalledWith("Tendril", "Tendril2");
        expect(putConfig).not.toHaveBeenCalled();
      });

      /**
       * Two things at once, because they are the same mistake: the draft is trimmed before it is
       * sent, and the *toast* names the daemon's echo rather than the draft. A route that trims
       * differently - or at all, when this one did not - must not leave the operator reading a name
       * that is not in config.yaml.
       */
      it("sends the trimmed draft and toasts the daemon's stored name", async () => {
        const rename = vi.spyOn(bridge, "renameProject").mockResolvedValue("Stored");
        await renderProject(configWith({}));

        const input = await openRename();
        fireEvent.change(input, { target: { value: "  Trimmed  " } });
        await clickButton("Confirm rename");

        expect(rename).toHaveBeenCalledWith("Tendril", "Trimmed");
        expect(notifySuccess).toHaveBeenCalledWith("Renamed", "Renamed project to 'Stored'");
      });

      it("commits on Enter and reverts on Escape", async () => {
        const rename = vi.spyOn(bridge, "renameProject").mockResolvedValue("ByKey");
        await renderProject(configWith({}));

        let input = await openRename();
        fireEvent.change(input, { target: { value: "ByKey" } });
        await act(async () => {
          fireEvent.keyDown(input, { key: "Enter" });
        });
        expect(rename).toHaveBeenCalledWith("Tendril", "ByKey");

        rename.mockClear();
        input = await openRename();
        fireEvent.change(input, { target: { value: "Discarded" } });
        await act(async () => {
          fireEvent.keyDown(input, { key: "Escape" });
        });
        expect(rename).not.toHaveBeenCalled();
        expect(screen.queryByTestId("project-name-input")).not.toBeInTheDocument();
      });

      /** `InputSanitizer.DescribeProjectNameError`, with the suggestion clause V1 appends. */
      it("refuses a name the config cannot hold, before the round trip", async () => {
        const rename = vi.spyOn(bridge, "renameProject").mockResolvedValue("x");
        await renderProject(configWith({}));

        const input = await openRename();
        fireEvent.change(input, { target: { value: "my project" } });

        expect(screen.getByTestId("project-name-error")).toHaveTextContent(
          "Suggested: 'myproject'",
        );
        expect(screen.getByRole("button", { name: "Confirm rename" })).toBeDisabled();

        // Enter, not the button: a disabled button cannot be clicked, so clicking it would pass
        // whether or not the commit path itself refuses the name. Enter reaches the handler.
        await act(async () => {
          fireEvent.keyDown(input, { key: "Enter" });
        });
        expect(rename).not.toHaveBeenCalled();
      });

      /** `EditProjectBladeView`'s duplicate scan, which is case-insensitive and skips this project. */
      it("refuses a sibling's name but allows a case-only change to its own", async () => {
        const rename = vi.spyOn(bridge, "renameProject").mockResolvedValue("TENDRIL");
        await renderProject(withProjects([{ name: "Tendril" }, { name: "Other" }]));

        const input = await openRename();
        fireEvent.change(input, { target: { value: "OTHER" } });
        expect(screen.getByTestId("project-name-error")).toHaveTextContent(
          "A project named 'OTHER' already exists.",
        );

        fireEvent.change(input, { target: { value: "TENDRIL" } });
        expect(screen.queryByTestId("project-name-error")).not.toBeInTheDocument();
        await clickButton("Confirm rename");
        expect(rename).toHaveBeenCalledWith("Tendril", "TENDRIL");
      });

      /**
       * A project that vanished from the header and then came back is a lie the operator may act on,
       * so a refused rename holds the editor open carrying the daemon's message.
       */
      it("keeps the editor open with the daemon's message when the rename is refused", async () => {
        vi.spyOn(bridge, "renameProject").mockRejectedValue(
          new Error("Project 'x' already exists"),
        );
        await renderProject(configWith({}));

        const input = await openRename();
        fireEvent.change(input, { target: { value: "Taken" } });
        await clickButton("Confirm rename");

        expect(screen.getByTestId("project-name-input")).toBeInTheDocument();
        expect(screen.getByTestId("project-name-error")).toHaveTextContent("already exists");
      });
    });

    /**
     * The reversible half of the Danger Zone.
     *
     * Named for the verb that happens. This button said "Delete Project" until now, over a route
     * (`DELETE /api/projects/:name`) that contains no `fs::` call of any kind - so the caption
     * underneath it was the only thing standing between an operator and the wrong expectation.
     */
    describe("Remove Project", () => {
      const openRemoveDialog = async () => {
        await clickButton("Remove Project");
        return screen.getByTestId("remove-project-dialog");
      };

      /** Framework's "never delete on single click": the button opens a confirm, it does not remove. */
      it("confirms first, then removes over the project route", async () => {
        const remove = vi.spyOn(bridge, "removeProject").mockResolvedValue(undefined);
        await renderProject(configWith({}));

        const dialog = await openRemoveDialog();
        expect(remove).not.toHaveBeenCalled();

        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        expect(remove).toHaveBeenCalledWith("Tendril");
        expect(putConfig).not.toHaveBeenCalled();
      });

      /**
       * The safety property of the split, and the reason the two actions are separate routes rather
       * than one route with a flag: the harmless button must be incapable of reaching the
       * destructive call. Nothing else in this file would notice if Remove started deleting - the
       * assertions above would all still pass.
       */
      it("never calls the destructive route", async () => {
        vi.spyOn(bridge, "removeProject").mockResolvedValue(undefined);
        const purge = vi.spyOn(bridge, "deleteProjectData").mockResolvedValue(undefined);
        await renderProject(configWith({}));

        const dialog = await openRemoveDialog();
        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        expect(purge).not.toHaveBeenCalled();
      });

      /**
       * `remove_project` contains no `fs::` call, so both the button's caption and the dialog say
       * what survives rather than reaching for V1's bare "This cannot be undone." - which is not
       * merely vague here but backwards, since adding the project back by name restores it.
       */
      it("says what stays on disk, in the danger zone and in the dialog", async () => {
        await renderProject(configWith({}));

        expect(screen.getByTestId("project-danger-zone")).toHaveTextContent(
          "Cloned repositories, plan folders and history are left on disk",
        );
        expect(await openRemoveDialog()).toHaveTextContent(/stay on disk/);
      });

      /** `SettingsApp`'s `onDeleteProject`: fall back to the first remaining project, and toast. */
      it("moves the selection to the first remaining project", async () => {
        vi.spyOn(bridge, "removeProject").mockResolvedValue(undefined);
        const getConfig = vi
          .spyOn(bridge, "getConfig")
          .mockResolvedValue(withProjects([{ name: "Tendril" }, { name: "Other" }]));
        await act(async () => {
          render(
            <SettingsView
              serviceInfo={serviceInfo}
              onRefreshHealth={vi.fn()}
              initialSection="project:1"
            />,
          );
        });

        const dialog = await openRemoveDialog();
        getConfig.mockResolvedValue(withProjects([{ name: "Tendril" }]));
        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        // The row, not the body: `selectedProject` falls back to the first project for an index that
        // no longer resolves, so the body would read "Tendril" whether the selection moved or not.
        expect(screen.getByTestId("settings-row-project-0")).toHaveAttribute(
          "aria-selected",
          "true",
        );
        expect(screen.queryByTestId("settings-row-project-1")).not.toBeInTheDocument();
        // "Removed", not "Deleted". The toast is the last thing the operator reads about what
        // happened, and a "Deleted" over a call that deleted nothing repeats the original mistake
        // after the button label has been fixed.
        expect(notifySuccess).toHaveBeenCalledWith(
          "Removed",
          "Removed project 'Other'. Its files are still on disk.",
        );
      });

      /** The last project leaves nothing to select, so V1 falls back to Coding Agent. */
      it("falls back to Coding Agent when the last project is removed", async () => {
        vi.spyOn(bridge, "removeProject").mockResolvedValue(undefined);
        const getConfig = vi.spyOn(bridge, "getConfig").mockResolvedValue(configWith({}));
        await act(async () => {
          render(
            <SettingsView
              serviceInfo={serviceInfo}
              onRefreshHealth={vi.fn()}
              initialSection="project:0"
            />,
          );
        });

        const dialog = await openRemoveDialog();
        getConfig.mockResolvedValue(withProjects([]));
        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        expect(screen.queryByTestId("project-settings-blades")).not.toBeInTheDocument();
        expect(screen.getByTestId("coding-agent-card")).toBeInTheDocument();
        // `fallsBackToCodingAgent` renders that card for an unresolvable project tag as well, so the
        // row's own state is what says the selection moved rather than merely failing to resolve.
        expect(screen.getByTestId("settings-row-coding-agent")).toHaveAttribute(
          "aria-selected",
          "true",
        );
      });

      /** A sidebar row that vanished and came back is the same lie the rename editor guards against. */
      it("keeps the dialog open with the daemon's message when the removal is refused", async () => {
        vi.spyOn(bridge, "removeProject").mockRejectedValue(new Error("Failed to save config"));
        await renderProject(configWith({}));

        const dialog = await openRemoveDialog();
        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        expect(screen.getByTestId("remove-project-dialog")).toHaveTextContent(
          "Failed to save config",
        );
        expect(screen.getByTestId("project-settings-Tendril")).toBeInTheDocument();
      });
    });

    /**
     * The irreversible half: `DELETE /api/projects/:name/data`, which removes the plan folders, the
     * project directory under `<TENDRIL_HOME>/Projects/` and the database rows before it drops the
     * config entry.
     *
     * It sits one button along from a harmless action, so the gate is not decoration: these pin that
     * the confirm is refused until the project's name is typed, and that the typing reaches the
     * keyboard path as well as the button.
     */
    describe("Delete Project", () => {
      const openDeleteDialog = async () => {
        await clickButton("Delete Project");
        return screen.getByTestId("delete-project-dialog");
      };

      const typeName = async (dialog: HTMLElement, value: string) => {
        await act(async () => {
          fireEvent.change(within(dialog).getByTestId("delete-project-confirm"), {
            target: { value },
          });
        });
      };

      it("refuses to delete until the project name is typed", async () => {
        const purge = vi.spyOn(bridge, "deleteProjectData").mockResolvedValue(undefined);
        await renderProject(configWith({}));

        const dialog = await openDeleteDialog();
        const confirm = within(dialog).getByTestId("dialog-confirm");
        expect(confirm).toBeDisabled();

        await act(async () => {
          fireEvent.click(confirm);
        });
        expect(purge).not.toHaveBeenCalled();

        // A name that is close but not the project's is still refused: the gate exists to make the
        // operator name *this* project, not to make them type something.
        await typeName(dialog, "Tendri");
        expect(within(dialog).getByTestId("dialog-confirm")).toBeDisabled();

        await typeName(dialog, "Tendril");
        expect(within(dialog).getByTestId("dialog-confirm")).toBeEnabled();
      });

      /**
       * `ConfirmDialog` withholds `onShortcut` whenever the confirm is disabled, so Ctrl+Enter is
       * closed by the same gate. Pinned here because it is the one path that does not go through the
       * button, and a gate that only guards the mouse is not a gate.
       */
      it("refuses the Ctrl+Enter chord while the gate is closed", async () => {
        const purge = vi.spyOn(bridge, "deleteProjectData").mockResolvedValue(undefined);
        await renderProject(configWith({}));

        const dialog = await openDeleteDialog();
        await act(async () => {
          fireEvent.keyDown(dialog, { key: "Enter", ctrlKey: true });
        });
        expect(purge).not.toHaveBeenCalled();

        await typeName(dialog, "Tendril");
        await act(async () => {
          fireEvent.keyDown(dialog, { key: "Enter", ctrlKey: true });
        });
        expect(purge).toHaveBeenCalledWith("Tendril");
      });

      it("deletes over the data route once the name matches", async () => {
        const purge = vi.spyOn(bridge, "deleteProjectData").mockResolvedValue(undefined);
        const remove = vi.spyOn(bridge, "removeProject").mockResolvedValue(undefined);
        await renderProject(configWith({}));

        const dialog = await openDeleteDialog();
        await typeName(dialog, "Tendril");
        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        expect(purge).toHaveBeenCalledWith("Tendril");
        // The detach route is not a fallback and not a second step: it would leave the config entry
        // gone either way, and calling both would hide a failure of the one that matters.
        expect(remove).not.toHaveBeenCalled();
        expect(putConfig).not.toHaveBeenCalled();
      });

      /**
       * The gate is case-insensitive because `purge_project` matches the project with
       * `eq_ignore_ascii_case` - a gate stricter than the route it guards would only be a spelling
       * test.
       */
      it("accepts the name in any case, as the route matches it", async () => {
        const purge = vi.spyOn(bridge, "deleteProjectData").mockResolvedValue(undefined);
        await renderProject(configWith({}));

        const dialog = await openDeleteDialog();
        await typeName(dialog, "  tendril  ");
        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        // The stored spelling is sent, not what was typed: the route is addressed by path segment.
        expect(purge).toHaveBeenCalledWith("Tendril");
      });

      /** What is destroyed, said before the button is pressed as well as inside the dialog. */
      it("names what it destroys, and what it keeps", async () => {
        await renderProject(configWith({}));

        expect(screen.getByTestId("project-danger-zone")).toHaveTextContent("Permanently deletes");
        const dialog = await openDeleteDialog();
        expect(dialog).toHaveTextContent(/cannot be undone/);
        expect(dialog).toHaveTextContent(/Job logs are kept/);
        // The way out, for an operator who opened the wrong one of two adjacent buttons.
        expect(within(dialog).getByTestId("delete-project-data-warning")).toHaveTextContent(
          /Remove Project/,
        );
      });

      it("moves the selection and says the data went too", async () => {
        vi.spyOn(bridge, "deleteProjectData").mockResolvedValue(undefined);
        const getConfig = vi
          .spyOn(bridge, "getConfig")
          .mockResolvedValue(withProjects([{ name: "Tendril" }, { name: "Other" }]));
        await act(async () => {
          render(
            <SettingsView
              serviceInfo={serviceInfo}
              onRefreshHealth={vi.fn()}
              initialSection="project:1"
            />,
          );
        });

        const dialog = await openDeleteDialog();
        await typeName(dialog, "Other");
        getConfig.mockResolvedValue(withProjects([{ name: "Tendril" }]));
        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        expect(screen.getByTestId("settings-row-project-0")).toHaveAttribute(
          "aria-selected",
          "true",
        );
        expect(notifySuccess).toHaveBeenCalledWith(
          "Deleted",
          "Deleted project 'Other' and its data",
        );
      });

      /**
       * 409 while a job of the project is running is the daemon refusing to delete a worktree out
       * from under a live agent. The answer is to stop the job, so the message has to be readable
       * where the button was pressed rather than replaced by a vanished sidebar row.
       */
      it("keeps the dialog open with the daemon's refusal", async () => {
        vi.spyOn(bridge, "deleteProjectData").mockRejectedValue(
          new Error("Project 'Tendril' has running jobs: 1184"),
        );
        await renderProject(configWith({}));

        const dialog = await openDeleteDialog();
        await typeName(dialog, "Tendril");
        await act(async () => {
          fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
        });

        expect(screen.getByTestId("delete-project-dialog")).toHaveTextContent("running jobs: 1184");
        expect(screen.getByTestId("project-settings-Tendril")).toBeInTheDocument();
      });
    });

    /** The gate as a function, so the safety property is pinned apart from the DOM that renders it. */
    describe("confirmsProjectName", () => {
      it("arms on the name, in any case, with surrounding space ignored", () => {
        expect(confirmsProjectName("Tendril", "Tendril")).toBe(true);
        expect(confirmsProjectName("  tendril ", "Tendril")).toBe(true);
        expect(confirmsProjectName("TENDRIL", "Tendril")).toBe(true);
      });

      it("stays closed for anything else", () => {
        expect(confirmsProjectName("", "Tendril")).toBe(false);
        expect(confirmsProjectName("Tendri", "Tendril")).toBe(false);
        expect(confirmsProjectName("Tendril V2", "Tendril")).toBe(false);
        expect(confirmsProjectName("delete", "Tendril")).toBe(false);
      });

      /* A blank target would otherwise be armed by a blank field, which is no gate at all. */
      it("cannot be armed by a project with no name", () => {
        expect(confirmsProjectName("", "")).toBe(false);
        expect(confirmsProjectName("   ", "  ")).toBe(false);
      });
    });
  });
});

/**
 * `EditProjectBladeView`'s three ordering helpers. A project's `verifications` array **is** its run
 * order, so these are what make reordering mean anything.
 */
describe("verification run order", () => {
  const registry: VerificationDef[] = [
    { name: "Build", prompt: "", rest: {} },
    { name: "Tests", prompt: "", rest: {} },
    { name: "Lint", prompt: "", rest: {} },
  ];
  const ref = (name: string, required = false): ProjectVerificationRef => ({
    name,
    required,
    rest: {},
  });

  it("puts the project's own entries first, in the project's order", () => {
    expect(orderForDisplay([ref("Lint"), ref("Build")], registry).map((v) => v.name)).toEqual([
      "Lint",
      "Build",
      "Tests",
    ]);
  });

  it("drops a project entry the registry does not define", () => {
    expect(orderForDisplay([ref("Ghost")], registry).map((v) => v.name)).toEqual([
      "Build",
      "Tests",
      "Lint",
    ]);
  });

  it("keeps only the enabled entries when reordering, in the new order", () => {
    const displayed = orderForDisplay([ref("Build"), ref("Lint", true)], registry);
    // Displayed is Build, Lint, Tests; the drag moves Lint to the front.
    const next = reorderProjectVerifications([1, 0, 2], displayed, [
      ref("Build"),
      ref("Lint", true),
    ]);
    expect(next).toEqual([
      { name: "Lint", required: true, rest: {} },
      { name: "Build", required: false, rest: {} },
    ]);
  });

  it("appends an enabled entry the mapping did not mention rather than dropping it", () => {
    const displayed = orderForDisplay([ref("Build")], registry);
    expect(reorderProjectVerifications([], displayed, [ref("Build")])).toEqual([
      { name: "Build", required: false, rest: {} },
    ]);
  });

  it("toggles Required in place once a verification is already enabled", () => {
    expect(
      applyVerificationChange({ name: "Build", enabled: true, required: true }, [ref("Build")]),
    ).toEqual([{ name: "Build", required: true, rest: {} }]);
  });
});
