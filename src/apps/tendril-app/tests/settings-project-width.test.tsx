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

/**
 * The per-cell caps above bound the *tables*, and are not enough on their own: the screen also holds
 * prose with no cap — the ports merge note, the delete-unavailable note — and `SubSection`'s header is
 * `justify-between`, so its "Add …" button is pinned to the right edge of whatever width the body has.
 *
 * With no cap on the body the blade row (`BladeContainer`, `w-max`) took its width from that content, so
 * the pane laid out ~1200px of screen inside ~950px of window: the "Add Verification" and "Add Port"
 * buttons and the tables' Edit/Delete column sat off the right edge, unreachable because both
 * `ScrollArea`s render a vertical scrollbar only and Radix therefore sets `overflow-x: hidden`.
 *
 * So the cap belongs on the body root, where it bounds every child at once. Pinned here because it is a
 * single class on a container that no other assertion in this file would miss.
 */
describe("the project screen as a whole", () => {
  it("caps its own width rather than growing to fit its widest child", async () => {
    // A project with no table rows: the cap is on the body root, so it does not depend on any one
    // section's content, and this keeps the assertion off the `DataTable` the cases above need.
    await renderProject(projectConfig({}));

    const body = screen.getByTestId("project-settings-Tendril");
    // `max-w-170` is the width the forms and tables inside it already use, and the same one every other
    // settings section applies to its body.
    expect(body.className).toMatch(/\bmax-w-170\b/);
    // Without `min-w-0` the cap still holds, but the body cannot shrink below its content as a flex
    // item, which is how the same overflow returns in the collapsed layout.
    expect(body).toHaveClass("min-w-0");
  });
});

/**
 * The same cap, on the *section* screens rather than the project one.
 *
 * Every section repeated `max-w-170` by hand on its own body wrapper, and three of them — Team Vault,
 * Daemon Diagnostics and Newsletter — never did, so they ran the full width of the pane while
 * everything around them stopped at the same column. The cap now lives on `SettingsSection` itself, so
 * a section is bounded by being a section; this pins that, because the failure mode is silent (a new
 * section that forgets the class simply looks wrong, and nothing else fails).
 */
async function renderSection(section: string) {
  vi.spyOn(bridge, "getConfig").mockResolvedValue(projectConfig({}));
  await act(async () => {
    render(
      <SettingsView serviceInfo={serviceInfo} onRefreshHealth={vi.fn()} initialSection={section} />,
    );
  });
}

describe("every settings section shares one width", () => {
  it.each([
    ["newsletter", "newsletter-card"],
    ["advanced", "advanced-settings-card"],
    ["plans", "plans-settings-card"],
  ])("caps %s at the shared settings container", async (section, testId) => {
    await renderSection(section);

    const card = screen.getByTestId(testId);
    expect(card.className).toMatch(/\bmax-w-170\b/);
    // Without `min-w-0` the cap holds but the element cannot shrink below its content as a flex item.
    expect(card).toHaveClass("min-w-0");
  });

  /**
   * `ServiceSettingsView` and `ModelCatalogCard` are the two that render outside `SettingsView`'s own
   * JSX, which is how they came to miss the cap in the first place.
   */
  it("caps the sections that live in their own components", async () => {
    await renderSection("advanced");

    const service = screen.getByTestId("service-settings-view");
    // It renders two `SettingsSection`s rather than carrying the cap itself, so assert on those.
    const sections = service.querySelectorAll("section");
    expect(sections.length).toBeGreaterThan(0);
    sections.forEach((section) => expect(section.className).toMatch(/\bmax-w-170\b/));
  });
});

/**
 * V1 draws no rule between settings blocks: across all 14 `*SetupView.cs` only `AccountSetupView` and
 * `TunnelSetupView` contain a separator at all. V2 had one on every `SubSection` — and because
 * `first:border-t-0` only fires for a true first child, which none of the three consumers has, all 17
 * instances drew one. Blocks are separated by spacing.
 */
describe("settings blocks are separated by spacing, not rules", () => {
  it("draws no rule above any project sub-section", async () => {
    await renderProject(projectConfig({}));

    const body = screen.getByTestId("project-settings-Tendril");
    const sections = body.querySelectorAll("section");
    expect(sections.length).toBeGreaterThan(0);
    sections.forEach((section) => expect(section.className).not.toMatch(/\bborder-t\b/));
  });
});

/**
 * The top-level sections rail (everything that is not the project or config-editor screen) draws its
 * own divider between whichever sections render together, on the container rather than on any one
 * section - so a bare `space-y-10` cannot silently replace it and drop the rule again.
 */
describe("top-level settings sections are separated by a divider", () => {
  it("carries divide-y and equal padding above and below each divider on its container", async () => {
    await renderSection("advanced");

    const card = screen.getByTestId("advanced-settings-card");
    const container = card.parentElement;
    expect(container, "the sections container must be the card's direct parent").not.toBeNull();
    expect(container!.className).toMatch(/\bdivide-y\b/);
    expect(container!.className).toMatch(/\bdivide-border\b/);
    expect(container!.className).toMatch(/\[&>\*\]:py-10/);
  });
});
