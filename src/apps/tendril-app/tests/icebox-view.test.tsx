/**
 * The Icebox's two ways off the ice, against `Apps/Icebox/ContentView.cs` and
 * `Apps/Icebox/SidebarView.cs`.
 *
 * The point of these is that `Icebox` used to be a one-way door in V2: `DeletePlanDialog` puts a plan
 * in and nothing took it out, so the state was unreachable in both senses — no Thaw and no Delete.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { IceboxView } from "../src/views/IceboxView";
import { bridge } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";
import { bridgeError } from "./fixtures/recommendation.fixture";
import type { PlanSummary } from "../src/types/api";

const iced = (overrides: Partial<PlanSummary> = {}): PlanSummary =>
  planSummary({ id: "00300", title: "Deferred Idea", state: "Icebox", ...overrides });

const renderView = (plans: PlanSummary[], onPlanChanged?: (id: string) => void) =>
  render(<IceboxView plans={plans} onSelectPlan={vi.fn()} onPlanChanged={onPlanChanged} />);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IceboxView listing", () => {
  it("shows only Icebox plans", () => {
    renderView([iced(), planSummary({ id: "00301", state: "Draft", title: "Not On Ice" })]);

    expect(screen.getByText("Deferred Idea")).toBeInTheDocument();
    expect(screen.queryByText("Not On Ice")).not.toBeInTheDocument();
  });

  it("uses V1's empty-icebox copy, and the filter copy only when a filter hid something", () => {
    const { unmount } = renderView([]);
    // `NoContentView("Icebox is empty", "Plans you put on ice will appear here")`.
    expect(screen.getByText("Icebox is empty")).toBeInTheDocument();
    unmount();

    renderView([iced()]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing matches" } });
    expect(screen.getByText("No icebox plans match the current filters.")).toBeInTheDocument();
  });

  it("filters by level, which V1's sidebar offers beside the project filter", () => {
    renderView([
      iced({ id: "00300", title: "A Bug", level: "Bug" }),
      iced({ id: "00301", title: "A Feature", level: "Feature" }),
    ]);

    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "Bug" } });

    expect(screen.getByText("A Bug")).toBeInTheDocument();
    expect(screen.queryByText("A Feature")).not.toBeInTheDocument();
  });
});

describe("IceboxView thaw", () => {
  it("writes the plan back to Draft and drops the card", async () => {
    const updatePlanField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    const onPlanChanged = vi.fn();

    renderView([iced()], onPlanChanged);

    fireEvent.click(screen.getByRole("button", { name: /thaw plan/i }));

    // `TransitionState(selectedPlan.FolderName, PlanStatus.Draft)`. Four arguments because the write
    // goes through `plansStore.transitionPlanOptimistic`, which passes `allowFailedVerifications` on.
    await waitFor(() =>
      expect(updatePlanField).toHaveBeenCalledWith("00300", "state", "Draft", undefined),
    );
    expect(onPlanChanged).toHaveBeenCalledWith("00300");
    // The host's plan list has not refetched yet, so the view has to drop the card itself or it
    // keeps offering a second Thaw on a plan that already moved.
    await waitFor(() =>
      expect(screen.queryByTestId("icebox-plan-card-00300")).not.toBeInTheDocument(),
    );
  });

  it("keeps the card and says why when the daemon refuses", async () => {
    vi.spyOn(bridge, "updatePlanField").mockRejectedValue(
      bridgeError({ code: "CONFLICT", message: "a job still holds this plan" }),
    );

    renderView([iced()]);
    fireEvent.click(screen.getByRole("button", { name: /thaw plan/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/a job still holds this plan/),
    );
    // A plan that vanished and came back is worse than one that never moved.
    expect(screen.getByTestId("icebox-plan-card-00300")).toBeInTheDocument();
  });

  it("refuses a second thaw while the first is in flight", async () => {
    let release: () => void = () => {};
    const updatePlanField = vi
      .spyOn(bridge, "updatePlanField")
      .mockReturnValue(new Promise<void>((resolve) => (release = () => resolve())));

    renderView([iced()]);
    fireEvent.click(screen.getByRole("button", { name: /thaw plan/i }));

    const busy = await screen.findByRole("button", { name: /thaw plan/i });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(updatePlanField).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(updatePlanField).toHaveBeenCalledTimes(1));
  });
});

describe("IceboxView delete", () => {
  it("deletes through the shared confirm dialog and drops the card", async () => {
    const deletePlan = vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);

    renderView([iced()]);
    fireEvent.click(screen.getByRole("button", { name: /delete plan/i }));

    const dialog = await screen.findByTestId("delete-plan-dialog");
    // Framework's confirm shape, which V1's own Icebox delete dialog also has: one click on the
    // destructive answer, nothing to type first.
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deletePlan).toHaveBeenCalledWith("00300"));
    await waitFor(() =>
      expect(screen.queryByTestId("icebox-plan-card-00300")).not.toBeInTheDocument(),
    );
  });
});

/**
 * `SidebarView.BuildRowBadges`: the projects, then
 * `new Badge(plan.Level).Color(config.GetLevelColor(plan.Level) ?? Colors.Gray).Small()`.
 *
 * The card used to print the level as a plain footer line, so the one thing the level badge exists to
 * communicate — which level it is, at a glance — was not communicated at all.
 */
describe("IceboxView level badge", () => {
  const DEFAULT_LEVELS = [
    { name: "Bug", color: "Red" },
    { name: "Feature", color: "Blue" },
    { name: "Epic", color: "Purple" },
    { name: "Chore", color: "Slate" },
    { name: "Nitpick", color: "Gray" },
  ];

  it.each([
    ["Bug", "Red"],
    ["Feature", "Blue"],
    ["Epic", "Purple"],
    ["Chore", "Slate"],
    ["Nitpick", "Gray"],
  ])("colours a %s card's level badge %s", async (level, color) => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: { levels: DEFAULT_LEVELS } });

    renderView([iced({ level })]);

    await waitFor(() =>
      expect(screen.getByTestId(`level-badge-${level}`)).toHaveAttribute("data-level-color", color),
    );
  });

  it("puts the level in the badge row rather than as plain footer text", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: { levels: DEFAULT_LEVELS } });

    renderView([iced({ level: "Bug", project: "Tendril" })]);

    const badge = await waitFor(() => screen.getByTestId("level-badge-Bug"));
    // Beside the state and project badges, which is where `BuildRowBadges` appends it.
    const badgeRow = badge.parentElement as HTMLElement;
    expect(within(badgeRow).getByText("Icebox")).toBeInTheDocument();
    expect(within(badgeRow).getByText("Tendril")).toBeInTheDocument();
  });
});
