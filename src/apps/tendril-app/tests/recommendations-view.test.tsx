/**
 * The recommendation inbox's state machine and action guards, against
 * `Apps/Recommendations/RecommendationsApp.cs` and `Apps/Recommendations/ContentView.cs`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { RecommendationsView } from "../src/views/RecommendationsView";
import { bridge } from "../src/api/bridge";
import { bridgeError } from "./fixtures/recommendation.fixture";
import type { CrossPlanRecommendation } from "../src/types/api";

const rec = (overrides: Partial<CrossPlanRecommendation> = {}): CrossPlanRecommendation => ({
  planId: "00021",
  planTitle: "Build Desktop Operator Experience",
  project: "Tendril-App",
  sourcePlanStatus: "Completed",
  title: "Tauri WebDriver E2E Automation",
  description: "Drive the packaged app with tauri-driver.",
  impact: "Medium",
  state: "Pending",
  ...overrides,
});

const renderView = (props: Partial<React.ComponentProps<typeof RecommendationsView>> = {}) =>
  render(
    <RecommendationsView
      onSelectPlan={props.onSelectPlan ?? vi.fn()}
      onJobStarted={props.onJobStarted}
    />,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RecommendationsView source-plan gate", () => {
  it("shows only recommendations whose source plan completed", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "From a completed plan", sourcePlanStatus: "Completed" }),
      rec({ planId: "00022", title: "From a failed plan", sourcePlanStatus: "Failed" }),
      rec({ planId: "00023", title: "From a running plan", sourcePlanStatus: "Executing" }),
    ]);

    renderView();

    // `RecommendationsApp.Build`: `r.SourcePlanStatus == PlanStatus.Completed`. Accepting starts a
    // CreatePlan job, and a plan still running may do the work itself.
    await waitFor(() => expect(screen.getByText("From a completed plan")).toBeInTheDocument());
    expect(screen.queryByText("From a failed plan")).not.toBeInTheDocument();
    expect(screen.queryByText("From a running plan")).not.toBeInTheDocument();
  });

  it("keeps a row whose source status the transport did not carry", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "No source status", sourcePlanStatus: undefined }),
    ]);

    renderView();

    await waitFor(() => expect(screen.getByText("No source status")).toBeInTheDocument());
  });

  it("says the set is empty rather than blaming the filters when nothing loaded", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([]);

    renderView();

    // The status chips default to Pending, so keying the copy off the controls told a fresh install
    // its filters were at fault. V1's `NoContentView` copy is unconditional for an empty set.
    await waitFor(() =>
      expect(
        screen.getByText("Recommendations from completed plans will appear here."),
      ).toBeInTheDocument(),
    );
  });
});

describe("RecommendationsView status filter", () => {
  it("filters by the status the badge select emits", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "Still pending", state: "Pending" }),
      rec({ planId: "00022", title: "Already declined", state: "Declined" }),
    ]);

    renderView();
    await waitFor(() => expect(screen.getByText("Still pending")).toBeInTheDocument());
    expect(screen.queryByText("Already declined")).not.toBeInTheDocument();

    // BadgeSelect emits through `eventHandler`, not an `onChange` prop. Without that wiring the
    // trigger opened and no selection ever arrived, so the filter was inert. With a selection
    // showing, BadgeSelect's trigger is a combobox rather than a button.
    fireEvent.click(screen.getByRole("combobox", { name: /filter by status/i }));
    fireEvent.click(screen.getByRole("option", { name: "Declined" }));
    fireEvent.click(screen.getByRole("option", { name: "Pending" }));

    await waitFor(() => expect(screen.getByText("Already declined")).toBeInTheDocument());
    expect(screen.queryByText("Still pending")).not.toBeInTheDocument();
  });
});

describe("RecommendationsView actions", () => {
  it("writes Accepted, then starts a CreatePlan job from the description", async () => {
    const list = vi
      .spyOn(bridge, "listCrossPlanRecommendations")
      .mockResolvedValue([rec({ description: "Do the thing." })]);
    const setState = vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);
    const startJob = vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "00500", status: "Queued" });
    const onJobStarted = vi.fn();

    renderView({ onJobStarted });
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(setState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "Accepted",
        undefined,
        undefined,
      ),
    );
    expect(startJob).toHaveBeenCalledWith({
      type: "CreatePlan",
      prompt: "Do the thing.",
      project: "Tendril-App",
    });
    expect(onJobStarted).toHaveBeenCalledWith({ jobId: "00500", status: "Queued" });
    // `ContentView` calls `refresh()` after every action; the list is re-read, not merely patched.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("wraps the note in V1's envelope for Accept with Notes", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ description: "Do the thing." }),
    ]);
    const setState = vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);
    const startJob = vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "00501", status: "Queued" });

    renderView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Accept with Notes" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept with Notes" }));
    const dialog = await screen.findByTestId("recommendation-note-dialog");
    fireEvent.change(within(dialog).getByLabelText("Optional note"), {
      target: { value: "Use tauri-driver, not Playwright." },
    });
    fireEvent.click(within(dialog).getByTestId("rec-dialog-submit"));

    await waitFor(() =>
      expect(setState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "AcceptedWithNotes",
        undefined,
        "Use tauri-driver, not Playwright.",
      ),
    );
    // `AcceptWithNotesDialog`'s callback builds exactly this description.
    expect(startJob.mock.calls[0][0].prompt).toBe(
      "[ORIGINAL RECOMMENDATION]\nDo the thing.\n\n[NOTES]\nUse tauri-driver, not Playwright.",
    );
  });

  it("declines with a reason and starts no job", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([rec()]);
    const setState = vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);
    const startJob = vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "nope", status: "Queued" });

    renderView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    const dialog = await screen.findByTestId("recommendation-note-dialog");
    fireEvent.change(within(dialog).getByLabelText("Decline reason"), {
      target: { value: "Superseded by 00700." },
    });
    fireEvent.click(within(dialog).getByTestId("rec-dialog-submit"));

    await waitFor(() =>
      expect(setState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "Declined",
        "Superseded by 00700.",
        undefined,
      ),
    );
    // `ContentView`'s decline handler writes the state and nothing else.
    expect(startJob).not.toHaveBeenCalled();
  });

  it("refuses a second Accept while the first is in flight", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([rec()]);
    let release: () => void = () => {};
    const setState = vi
      .spyOn(bridge, "setRecommendationState")
      .mockReturnValue(new Promise<void>((resolve) => (release = () => resolve())));
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "00502", status: "Queued" });

    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    // A double click would otherwise cost two plans and two agent runs; V1 avoids it by moving the
    // selection on (`GoToNext`), which a list cannot do.
    const busy = await screen.findByRole("button", { name: "Accepting..." });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(setState).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(setState).toHaveBeenCalledTimes(1));
  });

  it("names an accepted-but-not-started recommendation for what it is", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([rec()]);
    vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);
    vi.spyOn(bridge, "startJob").mockRejectedValue(
      bridgeError({ code: "JOB_START_FAILED", message: "no agent configured" }),
    );

    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    // The write landed and the job did not: two different problems needing two different fixes, so
    // they must not share one "failed to update" message.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /accepted, but the CreatePlan job did not start/i,
      ),
    );
  });

  it("starts no job when the state write itself is refused", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([rec()]);
    vi.spyOn(bridge, "setRecommendationState").mockRejectedValue(bridgeError({}));
    const startJob = vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "nope", status: "Queued" });

    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(startJob).not.toHaveBeenCalled();
    // Still Pending, so the operator can retry.
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("offers no actions on a recommendation already in a terminal state", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ state: "Declined", declineReason: "Superseded." }),
    ]);

    renderView();
    // The status chips default to Pending, so the terminal row has to be filtered into view first.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /filter by status/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("combobox", { name: /filter by status/i }));
    fireEvent.click(screen.getByRole("option", { name: "Declined" }));

    const row = await screen.findByTestId("recommendation-row-Tauri WebDriver E2E Automation");
    expect(within(row).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
    expect(within(row).getByText(/Superseded\./)).toBeInTheDocument();
  });
});
