import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { PullRequestsView } from "../src/views/PullRequestsView";
import { bridge } from "../src/api/bridge";
import { prStatus, prSyncReport } from "./fixtures/plan.fixture";
import { bridgeError } from "./fixtures/recommendation.fixture";
import type { PrStatus } from "../src/types/api";

const unlisten = vi.fn();
const eventHandlers: Record<string, (event: { payload: unknown }) => void> = {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    eventHandlers[name] = handler;
    return Promise.resolve(unlisten);
  },
}));

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

const PR_610 = "https://github.com/SpaceCorps/Tendril-App/pull/71";
const PR_99 = "https://github.com/SpaceCorps/Tendril-Core/pull/12";
const PR_500 = "https://github.com/SpaceCorps/Tendril-App/pull/40";

/** Open / Merged / Closed across two projects and two repos, so every column has something to say. */
const rows: PrStatus[] = [
  prStatus({
    prUrl: PR_610,
    owner: "SpaceCorps",
    repo: "Tendril-App",
    number: 71,
    status: "Open",
    branch: "tendril/00610-TrackPullRequests",
    planId: "00610",
    planFolder: "00610-TrackPullRequests",
    planTitle: "Track Pull Requests",
    project: "Tendril-App",
    cost: 1.23,
    tokens: 160_000,
  }),
  prStatus({
    prUrl: PR_99,
    owner: "SpaceCorps",
    repo: "Tendril-Core",
    number: 12,
    status: "Merged",
    branch: "tendril/00099-SqliteMigrations",
    planId: "00099",
    planFolder: "00099-SqliteMigrations",
    planTitle: "SQLite Migrations",
    project: "Tendril-Core",
    cost: 10,
    tokens: 900,
  }),
  prStatus({
    prUrl: PR_500,
    owner: "SpaceCorps",
    repo: "Tendril-App",
    number: 40,
    status: "Closed",
    branch: null,
    planId: "00500",
    planFolder: "00500-AbandonedIdea",
    planTitle: "Abandoned Idea",
    project: "Tendril-App",
    cost: 9,
    tokens: 0,
  }),
];

/** The rendered body rows, in render order — how the sorting assertions read the table. */
function bodyRowText(): string[] {
  const table = screen.getByRole("table");
  const body = table.querySelectorAll("tbody tr");
  return Array.from(body).map((tr) => tr.textContent ?? "");
}

function renderView(props: Partial<React.ComponentProps<typeof PullRequestsView>> = {}) {
  return render(
    <PullRequestsView
      onSelectPlan={props.onSelectPlan ?? vi.fn()}
      onOpenNewPlanModal={props.onOpenNewPlanModal ?? vi.fn()}
    />,
  );
}

describe("PullRequestsView", () => {
  beforeEach(() => {
    for (const key of Object.keys(eventHandlers)) delete eventHandlers[key];
    openUrl.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders one row per pull request with status, cost and tokens", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue(rows);

    renderView();

    await waitFor(() => expect(screen.getByText("Open")).toBeInTheDocument());
    expect(screen.getByText("Merged")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();

    expect(bodyRowText()).toHaveLength(3);
    expect(screen.getByText("$1.23")).toBeInTheDocument();
    expect(screen.getByText("160.0k")).toBeInTheDocument();
    // Two of the three rows share the repository, hence the All variant.
    expect(screen.getAllByText("SpaceCorps/Tendril-App")).toHaveLength(2);
    expect(screen.getByText("tendril/00610-TrackPullRequests")).toBeInTheDocument();
    // Under 1000 tokens the Dashboard's format prints the raw count.
    expect(screen.getByText("900")).toBeInTheDocument();
  });

  /**
   * The user-visible half of collapsing the four copies of `formatTokens` into `utils/format`.
   *
   * This column's own copy was documented as "the Dashboard's format, so the app has one token
   * format rather than two" and had no millions branch, so a plan past a million tokens read
   * `1400.0k` here and `1.4M` on the Dashboard card the format came from. Now it carries.
   */
  it("carries a million-token plan into millions rather than printing thousands of k", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({ planId: "00701", planTitle: "Long Run", cost: 42, tokens: 1_400_000 }),
    ]);

    renderView();

    await waitFor(() => expect(screen.getByText(/Long Run/)).toBeInTheDocument());
    expect(screen.getByText("1.4M")).toBeInTheDocument();
    expect(screen.queryByText("1400.0k")).not.toBeInTheDocument();
  });

  // The other boundary the old copy got wrong: it tested `> 1000`, so exactly one thousand tokens
  // skipped the ladder and printed the bare count.
  it("enters the thousands ladder at exactly one thousand tokens", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({ planId: "00702", planTitle: "Round Thousand", cost: 1, tokens: 1_000 }),
    ]);

    renderView();

    await waitFor(() => expect(screen.getByText(/Round Thousand/)).toBeInTheDocument());
    expect(screen.getByText("1.0k")).toBeInTheDocument();
    expect(screen.queryByText("1000")).not.toBeInTheDocument();
  });

  it("leaves an empty cost or token total blank rather than printing zero", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({ planId: "00700", planTitle: "Unpriced Run", cost: 0, tokens: 0 }),
    ]);

    renderView();

    await waitFor(() => expect(screen.getByText(/Unpriced Run/)).toBeInTheDocument());
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("filters by plan title, project, repository and branch", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue(rows);

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(3));
    const search = screen.getByRole("searchbox", { name: /search pull requests/i });

    fireEvent.change(search, { target: { value: "SQLite" } });
    expect(bodyRowText()).toHaveLength(1);
    expect(screen.getByText(/SQLite Migrations/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Tendril-Core" } });
    expect(bodyRowText()).toHaveLength(1);

    fireEvent.change(search, { target: { value: "tendril/00610" } });
    expect(bodyRowText()).toHaveLength(1);
    expect(screen.getByText(/Track Pull Requests/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Tendril-App" } });
    expect(bodyRowText()).toHaveLength(2);
  });

  it("hides non-matching rows when a status is selected", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue(rows);

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: /filter by status/i }));
    fireEvent.click(screen.getByRole("option", { name: "Merged" }));

    expect(bodyRowText()).toHaveLength(1);
    expect(screen.getByText(/SQLite Migrations/)).toBeInTheDocument();
    expect(screen.queryByText(/Track Pull Requests/)).not.toBeInTheDocument();
  });

  it("sorts by plan descending by default and by cost numerically", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue(rows);

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(3));

    // Descending by plan id as a number, so 00610 leads and 00099 trails.
    expect(bodyRowText()[0]).toContain("#00610");
    expect(bodyRowText()[2]).toContain("#00099");

    // Ascending by cost: $9.00 before $10.00, which a lexical sort would invert.
    // DataTable names a sortable header after the sort it would apply, not after the column.
    fireEvent.click(screen.getByRole("button", { name: /^Sort by Cost/ }));
    const ascending = bodyRowText();
    expect(ascending[0]).toContain("$1.23");
    expect(ascending[1]).toContain("$9.00");
    expect(ascending[2]).toContain("$10.00");
  });

  it("opens the plan tab from the View Plan row action", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[0]]);
    const onSelectPlan = vi.fn();

    renderView({ onSelectPlan });
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "View Plan" }));
    expect(onSelectPlan).toHaveBeenCalledWith("00610");
  });

  it("opens the PR url from the Open PR row action", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[0]]);

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Open PR" }));
    expect(openUrl).toHaveBeenCalledWith(PR_610);
  });

  it("opens the revision sheet when the plan cell is clicked", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[0]]);
    const getRevision = vi
      .spyOn(bridge, "getRevision")
      .mockResolvedValue("# Track Pull Requests\n\nReconcile PR status on a timer.\n");

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /#00610 Track Pull Requests/ }));

    const dialog = await screen.findByRole("dialog");
    expect(getRevision).toHaveBeenCalledWith("00610");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("heading", { name: "Track Pull Requests", level: 1 }),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).getByText("#00610 Track Pull Requests")).toBeInTheDocument();
  });

  it("prefills the new plan modal from the Follow Up row action", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[0]]);
    const onOpenNewPlanModal = vi.fn();

    renderView({ onOpenNewPlanModal });
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Follow Up" }));

    expect(onOpenNewPlanModal).toHaveBeenCalledTimes(1);
    const prefill = onOpenNewPlanModal.mock.calls[0][0];
    expect(prefill.description).toContain("[Follows up on plan [00610]]");
    expect(prefill.description).toContain(PR_610);
    expect(prefill.sourceUrl).toBe(PR_610);
    expect(prefill.project).toBe("Tendril-App");
  });

  it("resyncs and refetches the list", async () => {
    const listPullRequests = vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[0]]);
    let resolveSync: (report: ReturnType<typeof prSyncReport>) => void = () => {};
    const syncPullRequests = vi
      .spyOn(bridge, "syncPullRequests")
      .mockReturnValue(new Promise((resolve) => (resolveSync = resolve)));

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Resync All" }));

    // Disabled while the pass is in flight, so a second click cannot stack another one.
    const button = screen.getByRole("button", { name: "Resyncing..." });
    expect(button).toBeDisabled();

    await act(async () => {
      resolveSync(prSyncReport({ changed: true }));
    });

    expect(syncPullRequests).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listPullRequests).toHaveBeenCalledTimes(2));
  });

  it("renders a failed resync inline, and a collision as a plain notice", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[0]]);
    const syncPullRequests = vi
      .spyOn(bridge, "syncPullRequests")
      .mockRejectedValue(bridgeError({ code: "GH_CLI_FAILED", message: "gh not authenticated" }));

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Resync All" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/gh not authenticated/),
    );

    // A pass already running is not the operator's mistake, so it is a notice with no alert role.
    syncPullRequests.mockRejectedValue(
      bridgeError({ code: "PR_SYNC_IN_PROGRESS", message: "already running", details: null }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Resync All" }));

    await waitFor(() =>
      expect(screen.getByText("A sync pass is already running.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refetches when a PR status change is broadcast", async () => {
    const listPullRequests = vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[0]]);

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));
    expect(listPullRequests).toHaveBeenCalledTimes(1);

    // route_ws_message classifies an unknown message type as a job event, which is why the helper
    // listens on both channels.
    await act(async () => {
      eventHandlers["job-event"]?.({ payload: { type: "pr_status_changed" } });
    });

    await waitFor(() => expect(listPullRequests).toHaveBeenCalledTimes(2));

    await act(async () => {
      eventHandlers["plan-event"]?.({ payload: { type: "pr_status_changed" } });
    });
    await waitFor(() => expect(listPullRequests).toHaveBeenCalledTimes(3));

    // An unrelated event must not cause a refetch.
    await act(async () => {
      eventHandlers["job-event"]?.({ payload: { type: "status", jobId: "03161" } });
    });
    expect(listPullRequests).toHaveBeenCalledTimes(3);
  });

  it("says what an Unknown status means and when it was last checked", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({ planId: "00800", status: "Unknown", lastChecked: null }),
    ]);

    renderView();

    // `pr_sync` records Unknown when a tracked URL is absent from its repository's `--limit 100`
    // window or when the `gh` call failed. A bare grey chip reads as a fourth PR state, which is
    // exactly what an operator skims past.
    const badge = await screen.findByText("Unknown");
    expect(badge).toHaveAttribute("title", expect.stringContaining("could not resolve"));
    expect(badge).toHaveAttribute("title", expect.stringContaining("never checked"));
  });

  it("says a sync refreshed nothing when every repository errored", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[0]]);
    vi.spyOn(bridge, "syncPullRequests").mockResolvedValue(
      prSyncReport({
        tracked: 1,
        checked: 0,
        errors: ["SpaceCorps/Tendril-App: gh: command not found"],
      }),
    );

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Resync All" }));

    // The pass returns success with a per-repository error list, so without this the operator sees a
    // Resync that appeared to work while nothing on screen moved.
    await waitFor(() =>
      expect(screen.getByText(/No status could be refreshed/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/gh auth status/)).toBeInTheDocument();
  });

  it("says a sync had nothing to do when every PR was skipped by a guard", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([rows[1]]);
    vi.spyOn(bridge, "syncPullRequests").mockResolvedValue(
      prSyncReport({ tracked: 3, checked: 0, skippedMerged: 2, skippedFresh: 1 }),
    );

    renderView();
    await waitFor(() => expect(bodyRowText()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Resync All" }));

    await waitFor(() => expect(screen.getByText(/Nothing to refresh/)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the empty state when no plan has a pull request", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);

    renderView();

    await waitFor(() => expect(screen.getByText("No pull requests")).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
