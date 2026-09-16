import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * A long URL in a project table must not make the project screen wider than its blade.
 *
 * The bug: a `<td>`'s min-content width is its longest *unbreakable* run, and a URL has no spaces to
 * break on — so one long review-action command made the table wider than the pane. The blade's content
 * sits inside a Radix `ScrollArea`, whose content wrapper is `display: table` and so shrink-to-fit, and
 * it grew to match: the whole screen gained a horizontal scrollbar.
 *
 * V1 never hit it because `ReviewActionsTableView`
 * (`Apps/Settings/Blades/ProjectTableViews.cs:385`) puts only `Action Name` and the button column in
 * its table — the command and condition live in the edit blade, not the grid.
 *
 * jsdom does no layout, so width itself is not observable here. What *is* observable is the structure
 * that bounds it: every column that can hold an unbroken string caps its cell and keeps the full value
 * in `title`. That is the thing a future edit would silently drop, so that is what is pinned.
 */

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(() => Promise.resolve()),
  openUrl: vi.fn(),
}));

/** No spaces anywhere: the shape that has no break opportunity and so sets min-content width. */
const LONG_URL = `https://github.enterprise.example.com/some-org/some-really-long-repository-name/blob/main/${"path-segment/".repeat(
  20,
)}file-with-a-very-long-name.md#L1234-L5678`;

const serviceInfo: ServiceInfo = {
  state: "Connected",
  tendrilHome: "/home/user/.tendril",
  port: 5010,
  host: "127.0.0.1",
  capabilities: ["plans"],
  message: "Online",
};

const projectConfig = (project: Record<string, unknown>): TendrilConfig => ({
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
  raw: {
    staleOutputTimeout: 10,
    beta: true,
    themeMode: "system",
    projects: [{ name: "Tendril", ...project }],
  },
});

async function renderProject(cfg: TendrilConfig) {
  vi.spyOn(bridge, "getConfig").mockResolvedValue(cfg);
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The element actually carrying the long string, found by the `title` the cap puts on it. */
const cappedCellFor = (tableTestId: string, value: string): HTMLElement => {
  const table = screen.getByTestId(tableTestId);
  const cell = within(table).getByTitle(value);
  return cell;
};

const CASES: {
  what: string;
  table: string;
  cfg: () => TendrilConfig;
}[] = [
  {
    what: "a review action's command",
    table: "project-review-actions-table",
    cfg: () => projectConfig({ reviewActions: [{ name: "Docs", command: LONG_URL }] }),
  },
  {
    what: "a review action's condition",
    table: "project-review-actions-table",
    cfg: () =>
      projectConfig({ reviewActions: [{ name: "Docs", command: "ok", condition: LONG_URL }] }),
  },
  {
    what: "an environment file's path",
    table: "project-env-files-table",
    cfg: () => projectConfig({ envFiles: [{ path: LONG_URL }] }),
  },
  {
    what: "an MCP server's command",
    table: "project-mcp-servers-table",
    cfg: () => projectConfig({ mcpServers: [{ name: "fetch", command: LONG_URL }] }),
  },
  {
    what: "a custom skill's path",
    table: "project-skills-table",
    cfg: () => projectConfig({ skills: [{ name: "release", path: LONG_URL }] }),
  },
];

describe.each(CASES)("$what cannot widen the project screen", ({ table, cfg }) => {
  it("is capped and truncated rather than laid out at full length", async () => {
    await renderProject(cfg());

    const cell = cappedCellFor(table, LONG_URL);
    // `truncate` is `overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap`; on its own
    // it does nothing, because ellipsizing needs a definite bound — hence the `max-w-*` beside it.
    expect(cell).toHaveClass("truncate");
    expect(cell.className).toMatch(/\bmax-w-/);
    // A `max-width` only binds a block; an inline span would ignore it.
    expect(cell).toHaveClass("block");
  });

  it("sits in a fixed-layout table, without which the cap cannot bound the table", async () => {
    // The cap bounds one *cell*. A `table-layout: auto` table still sizes to its content, so several
    // capped columns summed to far more than the pane and gave the whole settings view a horizontal
    // scrollbar — the reported symptom was being scrolled right with nothing visible. `table-fixed`
    // makes the columns divide the available width, which is also what gives `truncate` the definite
    // bound it needs. `JobsView` forces the same thing for the same reason.
    await renderProject(cfg());

    const el = cappedCellFor(table, LONG_URL);
    const tableEl = el.closest("table");
    expect(tableEl, "the capped cell must live in a table").not.toBeNull();

    // The variant is applied on the DataTable's wrapper, so assert the rule reaches the table rather
    // than looking for a literal class on it.
    const wrapper = tableEl!.closest("[class*='table-fixed']");
    expect(
      wrapper,
      "no ancestor applies table-fixed to this table — the cap cannot bound its width",
    ).not.toBeNull();
  });

  it("keeps the whole value readable, so capping loses nothing", async () => {
    await renderProject(cfg());

    const cell = cappedCellFor(table, LONG_URL);
    expect(cell).toHaveAttribute("title", LONG_URL);
    expect(cell).toHaveTextContent(LONG_URL);
  });

  it("puts the cap on the element holding the string, not on an ancestor", async () => {
    await renderProject(cfg());

    const cell = cappedCellFor(table, LONG_URL);
    // If the classes sat on a wrapper with the text in an uncapped child, the child's min-content
    // width would still drive the column and the bug would be back.
    expect(cell.textContent).toBe(LONG_URL);
    expect(cell.querySelectorAll("*")).toHaveLength(0);
  });
});

describe("the repositories list, which is a flex row rather than a table", () => {
  it("lets the long path shrink instead of pushing the row wider", async () => {
    await renderProject(projectConfig({ repos: [{ path: LONG_URL }] }));

    const path = screen.getByText(LONG_URL);
    // `min-w-0` is the fix for a flex item: its default `min-width: auto` refuses to shrink below
    // content, which is the same failure in a different layout mode.
    expect(path).toHaveClass("min-w-0", "flex-1", "truncate");
  });
});
