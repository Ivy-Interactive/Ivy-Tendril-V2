import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * Every destructive action in Settings goes through a confirm.
 *
 * Framework's rule is unconditional — `Ivy-Framework/src/claude-plugin/skills/ivy-create-app/
 * references/DesignGuidelines.md:147`: "Confirm destructive actions: Use `.WithConfirm()` — never
 * delete on single click." Six actions here used to rewrite `config.yaml` on the click itself:
 * removing a repository, and the `Delete` row action on levels, review actions, environment files,
 * MCP servers and custom skills.
 *
 * `settings-project-config.test.tsx` covers the payloads those writes send once confirmed; this file
 * pins the confirm itself — that it appears at all, that declining writes nothing, and that it is the
 * same shape as every other destructive confirm in the app.
 */

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

const config = (raw: Record<string, unknown>): TendrilConfig => ({
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
  raw: { staleOutputTimeout: 10, beta: true, themeMode: "system", ...raw },
});

async function renderSettings(cfg: TendrilConfig, section: string) {
  vi.spyOn(bridge, "getConfig").mockResolvedValue(cfg);
  await act(async () => {
    render(
      <SettingsView serviceInfo={serviceInfo} onRefreshHealth={vi.fn()} initialSection={section} />,
    );
  });
}

/** The `Delete` row action inside a given table, which is an icon button with an aria-label. */
const deleteRowIn = (testId: string): HTMLButtonElement => {
  const table = screen.getByTestId(testId);
  const button = Array.from(table.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === "Delete",
  );
  expect(button, `no Delete row action in ${testId}`).toBeTruthy();
  return button as HTMLButtonElement;
};

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

const projectWith = (project: Record<string, unknown>) =>
  config({ projects: [{ name: "Tendril", ...project }] });

let putConfig: ReturnType<typeof vi.spyOn>;

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * One table-driven pass over all six, so a seventh destructive action added without a confirm shows
 * up as an obviously missing row rather than as nothing at all.
 *
 * Delete Project is deliberately not a seventh. Every row here is a `useRemovalConfirm` request:
 * synchronous, `PUT /api/config`, and closed before its `onConfirm` even runs. Deleting the project
 * is an awaited `DELETE /api/projects/:name` that can be refused, so it needs a busy state and
 * somewhere to put the rejection, neither of which that hook has - it composes `ConfirmDialog`
 * directly instead, and `settings-project-config.test.tsx` covers it.
 */
const CASES: {
  what: string;
  section: string;
  cfg: () => TendrilConfig;
  open: () => HTMLElement;
  /** The words the body must contain, so each confirm names the right thing. */
  says: RegExp;
}[] = [
  {
    what: "a repository",
    section: "project:0",
    cfg: () => projectWith({ repos: [{ path: "/a" }, { path: "/b" }] }),
    open: () => screen.getByRole("button", { name: "Remove /a" }),
    says: /Remove repository .*\/a.* from this configuration\?/,
  },
  {
    what: "a review action",
    section: "project:0",
    cfg: () =>
      projectWith({
        reviewActions: [
          { name: "A", command: "a" },
          { name: "B", command: "b" },
        ],
      }),
    open: () => deleteRowIn("project-review-actions-table"),
    says: /Remove review action .*A.* from this configuration\?/,
  },
  {
    what: "an environment file",
    section: "project:0",
    cfg: () => projectWith({ envFiles: [{ path: ".env" }, { path: "apps/web/.env" }] }),
    open: () => deleteRowIn("project-env-files-table"),
    says: /Remove environment file .*\.env.* from this configuration\?/,
  },
  {
    what: "an MCP server",
    section: "project:0",
    cfg: () => projectWith({ mcpServers: [{ name: "fetch" }, { name: "github" }] }),
    open: () => deleteRowIn("project-mcp-servers-table"),
    says: /Remove MCP server .*fetch.* from this configuration\?/,
  },
  {
    what: "a custom skill",
    section: "project:0",
    cfg: () => projectWith({ skills: [{ name: "release" }, { name: "triage" }] }),
    open: () => deleteRowIn("project-skills-table"),
    says: /Remove custom skill .*release.* from this configuration\?/,
  },
  {
    what: "a priority level",
    section: "levels",
    cfg: () =>
      config({
        levels: [
          { name: "Bug", color: "Red" },
          { name: "Feature", color: "Blue" },
        ],
      }),
    open: () => deleteRowIn("levels-table"),
    says: /Remove level .*Bug.* from this configuration\?/,
  },
];

describe.each(CASES)("removing $what", ({ section, cfg, open, says }) => {
  it("asks first, and writes nothing on the click itself", async () => {
    await renderSettings(cfg(), section);

    await click(open());

    expect(await screen.findByTestId("settings-remove-dialog")).toBeInTheDocument();
    expect(putConfig).not.toHaveBeenCalled();
  });

  it("names what is being removed", async () => {
    await renderSettings(cfg(), section);
    await click(open());

    expect(screen.getByTestId("settings-remove-dialog")).toHaveTextContent(says);
  });

  it("writes once confirmed", async () => {
    await renderSettings(cfg(), section);
    await click(open());

    await click(within(screen.getByTestId("settings-remove-dialog")).getByTestId("dialog-confirm"));

    expect(putConfig).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when cancelled", async () => {
    await renderSettings(cfg(), section);
    await click(open());

    await click(within(screen.getByTestId("settings-remove-dialog")).getByTestId("dialog-cancel"));

    expect(screen.queryByTestId("settings-remove-dialog")).not.toBeInTheDocument();
    expect(putConfig).not.toHaveBeenCalled();
  });

  it("writes nothing on Escape", async () => {
    await renderSettings(cfg(), section);
    await click(open());

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByTestId("settings-remove-dialog")).not.toBeInTheDocument();
    expect(putConfig).not.toHaveBeenCalled();
  });
});

/**
 * The same footer contract as every other destructive confirm (`ConfirmShape.test.tsx`): Cancel
 * first and outline, the destructive answer last, nothing to type.
 */
describe("the settings removal confirm follows Framework's shape", () => {
  it("declines first as outline and confirms last as destructive, with nothing to type", async () => {
    await renderSettings(projectWith({ repos: [{ path: "/a" }] }), "project:0");
    await click(screen.getByRole("button", { name: "Remove /a" }));

    const dialog = screen.getByTestId("settings-remove-dialog");
    const cancel = within(dialog).getByTestId("dialog-cancel");
    const confirm = within(dialog).getByTestId("dialog-confirm");

    const footer = cancel.parentElement as HTMLElement;
    // Accessible names rather than `textContent`: the confirm carries an `aria-hidden`
    // `DialogShortcutHint` cap, which is exactly what keeps the *name* the bare verb while the
    // rendered text reads "Remove Ctrl \u21b5". See the same assertion in `DeletePlanDialog.test.tsx`.
    const buttons = [...footer.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    ["Cancel", "Remove"].forEach((name, i) =>
      expect(buttons[i]).toHaveAccessibleName(name),
    );
    expect(cancel).toHaveClass("border", "bg-background");
    expect(confirm).toHaveClass("bg-destructive");
    expect(confirm).toBeEnabled();
    expect(dialog.querySelectorAll("input, textarea")).toHaveLength(0);
  });

  /**
   * The copy is deliberately lighter than a plan deletion's: these entries can be added straight back
   * from the same screen, so the confirm must not borrow the language of something irreversible.
   */
  it("does not claim a config edit is permanent or unrecoverable", async () => {
    await renderSettings(projectWith({ repos: [{ path: "/a" }] }), "project:0");
    await click(screen.getByRole("button", { name: "Remove /a" }));

    const text = screen.getByTestId("settings-remove-dialog").textContent ?? "";
    expect(text).not.toMatch(/cannot be undone|permanently|irreversible/i);
    // It does still say what removal reaches beyond the row.
    expect(text).toMatch(/checkout on disk is untouched/);
  });
});
