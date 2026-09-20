import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { PlanPullRequests, canonicalPrUrl } from "../src/views/PlanPullRequests";
import { bridge } from "../src/api/bridge";
import { prStatus, prSyncReport } from "./fixtures/plan.fixture";
import { bridgeError } from "./fixtures/recommendation.fixture";

const unlisten = vi.fn();
let planEventHandler: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    if (name === "plan-event") planEventHandler = handler;
    return Promise.resolve(unlisten);
  },
}));

const PR_2 = "https://github.com/SpaceCorps/Tendril-App/pull/2";

describe("PlanPullRequests", () => {
  beforeEach(() => {
    planEventHandler = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the cached status, branch and last-checked time for each PR", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({ status: "Merged", branch: "tendril/00021-Something" }),
    ]);

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);

    await waitFor(() => expect(screen.getByText("Merged")).toBeInTheDocument());
    expect(screen.getByText("tendril/00021-Something")).toBeInTheDocument();
    expect(screen.getByText(/checked 5m ago/)).toBeInTheDocument();
    // The link stays, so an operator can still open the PR on GitHub.
    expect(screen.getByRole("link", { name: "#2" })).toHaveAttribute("href", PR_2);
  });

  it("reports a PR the daemon has not resolved as Unknown", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);

    await waitFor(() => expect(screen.getByText("Unknown")).toBeInTheDocument());
    expect(screen.queryByText(/checked/)).not.toBeInTheDocument();
  });

  it("matches a cached row recorded under a different spelling of the same URL", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({ prUrl: `${PR_2}/files`, status: "Closed" }),
    ]);

    render(<PlanPullRequests planId="00021" prs={[`${PR_2}#issuecomment-9`]} />);

    await waitFor(() => expect(screen.getByText("Closed")).toBeInTheDocument());
  });

  it("ignores the pull requests of other plans", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({ planId: "00099", status: "Merged" }),
    ]);

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);

    await waitFor(() => expect(screen.getByText("Unknown")).toBeInTheDocument());
    expect(screen.queryByText("Merged")).not.toBeInTheDocument();
  });

  it("re-reads the list after a manual refresh", async () => {
    const list = vi
      .spyOn(bridge, "listPullRequests")
      .mockResolvedValueOnce([prStatus({ status: "Open" })])
      .mockResolvedValue([prStatus({ status: "Merged" })]);
    const sync = vi
      .spyOn(bridge, "syncPullRequests")
      .mockResolvedValue(prSyncReport({ changed: true }));

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);
    await waitFor(() => expect(screen.getByText("Open")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByText("Merged")).toBeInTheDocument());
    expect(sync).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("treats a sync that is already running as a notice, not an error", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([prStatus()]);
    vi.spyOn(bridge, "syncPullRequests").mockRejectedValue(
      bridgeError({
        code: "PR_SYNC_IN_PROGRESS",
        message: "A pull request sync is already running",
        details: null,
      }),
    );

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);
    await waitFor(() => expect(screen.getByText("Open")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByText(/already running/i)).toBeInTheDocument());
    // The previously known status is still on screen.
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("surfaces a repository the daemon could not reach", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([prStatus()]);
    vi.spyOn(bridge, "syncPullRequests").mockResolvedValue(
      prSyncReport({ errors: ["acme/widgets: gh: could not resolve host github.com"] }),
    );

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);
    await waitFor(() => expect(screen.getByText("Open")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() =>
      expect(screen.getByText(/could not be reached for: acme\/widgets/i)).toBeInTheDocument(),
    );
  });

  it("re-reads the list when the daemon broadcasts a PR status change", async () => {
    const list = vi
      .spyOn(bridge, "listPullRequests")
      .mockResolvedValueOnce([prStatus({ status: "Open" })])
      .mockResolvedValue([prStatus({ status: "Merged" })]);

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);
    await waitFor(() => expect(screen.getByText("Open")).toBeInTheDocument());
    await waitFor(() => expect(planEventHandler).not.toBeNull());

    await act(async () => {
      planEventHandler?.({ payload: { type: "pr_status_changed" } });
    });

    await waitFor(() => expect(screen.getByText("Merged")).toBeInTheDocument());
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("ignores plan events that are not PR status changes", async () => {
    const list = vi.spyOn(bridge, "listPullRequests").mockResolvedValue([prStatus()]);

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);
    await waitFor(() => expect(screen.getByText("Open")).toBeInTheDocument());
    await waitFor(() => expect(planEventHandler).not.toBeNull());

    await act(async () => {
      planEventHandler?.({ payload: { type: "state", planId: "00021" } });
    });

    expect(list).toHaveBeenCalledTimes(1);
  });

  it("keeps the plan's URLs on screen when the daemon is down", async () => {
    vi.spyOn(bridge, "listPullRequests").mockRejectedValue(
      bridgeError({
        code: "DISCONNECTED",
        message: "Tendril service is not running",
        details: null,
      }),
    );

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);

    await waitFor(() =>
      expect(screen.getByText(/Tendril service is not running/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "#2" })).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("says so when the plan records no PRs", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);

    render(<PlanPullRequests planId="00021" prs={[]} />);

    await waitFor(() => expect(screen.getByText("No PRs created")).toBeInTheDocument());
  });
});

describe("canonicalPrUrl", () => {
  it("collapses every spelling of one PR", () => {
    for (const url of [
      PR_2,
      `${PR_2}/files`,
      `${PR_2}#issuecomment-1`,
      `${PR_2}?w=1`,
      `  ${PR_2}  `,
    ]) {
      expect(canonicalPrUrl(url)).toBe(PR_2);
    }
  });

  it("rejects a URL that is not a pull request", () => {
    expect(canonicalPrUrl("https://github.com/SpaceCorps/Tendril-App/issues/2")).toBeNull();
    expect(canonicalPrUrl("not a url")).toBeNull();
  });
});

/**
 * Audit item B5: this panel was wrapped in `CARD_SURFACE`, a hand-written
 * `rounded-box border border-border bg-card/40`.
 *
 * It is not replaced with the shared `Card`, which would be heavier still - full-opacity `bg-card`
 * plus `shadow`, and byte-for-byte the class string the Ivy Framework's own `Card` renders, so
 * there is no lighter shared variant to reach for. It is removed, because V1 draws no card here:
 * `GitTabView.cs:59` renders the PR section as `Text.Block("Pull Requests").Bold()` over a bare
 * `TableBuilder<PrTableRow>`. The heading pair is the section; the box was V2's addition.
 */
describe("PlanPullRequests draws no card", () => {
  it("renders the heading and rows on the bare surface V1 uses", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);

    render(<PlanPullRequests planId="00021" prs={[PR_2]} />);

    const panel = screen.getByText("Pull Requests").closest("div")?.parentElement;
    expect(panel).not.toBeNull();
    expect(panel!.className).not.toContain("bg-card");
    expect(panel!.className).not.toContain("border");
  });
});
