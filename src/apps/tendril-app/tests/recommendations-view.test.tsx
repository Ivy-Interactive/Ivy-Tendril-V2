/**
 * The recommendation inbox's state machine and action guards, against
 * `Apps/Recommendations/RecommendationsApp.cs` and `Apps/Recommendations/ContentView.cs`.
 */
/*
 * Loaded first on purpose, and side-effect only. `@radix-ui/react-dialog` resolves out of
 * `packages/components/node_modules` when nothing from `@ivy-interactive/components` is in the module
 * graph yet, and binds that package's own React copy - so the note dialog renders against a null hook
 * dispatcher ("Cannot read properties of null (reading 'useRef')"). Pulling the components entry in
 * first makes radix bind the deduped React. The real fix is one word in `vitest.config.ts`'s
 * `test.server.deps.inline` (see the report); this area does not own that file.
 */
import "@ivy-interactive/components/tendril";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { RecommendationsView } from "../src/views/RecommendationsView";
import { sidebarListStore } from "../src/state/sidebarListStore";
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
      // Spread last so a new prop does not have to be wired in here to reach the view. The
      // `projects` list arrived with the Create Issue button and was silently dropped until it was.
      {...props}
    />,
  );

beforeEach(() => {
  sidebarListStore.resetForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The list the page published into the shell sidebar, which is where its rows live now. */
const publishedTitles = (): string[] =>
  (sidebarListStore.getState()?.items ?? []).map((item) => item.title);

describe("RecommendationsView source-plan gate", () => {
  it("lists only recommendations whose source plan completed", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "From a completed plan", sourcePlanStatus: "Completed" }),
      rec({ planId: "00022", title: "From a failed plan", sourcePlanStatus: "Failed" }),
      rec({ planId: "00023", title: "From a running plan", sourcePlanStatus: "Executing" }),
    ]);

    renderView();

    // `RecommendationsApp.Build`: `r.SourcePlanStatus == PlanStatus.Completed`. Accepting starts a
    // CreatePlan job, and a plan still running may do the work itself.
    await waitFor(() => expect(publishedTitles()).toEqual(["From a completed plan"]));
  });

  it("keeps a row whose source status the transport did not carry", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "No source status", sourcePlanStatus: undefined }),
    ]);

    renderView();

    await waitFor(() => expect(publishedTitles()).toEqual(["No source status"]));
  });

  it("says the set is empty rather than blaming a filter when nothing loaded", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([]);

    renderView();

    // V1's `NoContentView` copy, and unconditional: this page has no filters to blame. Written
    // exactly as `Apps/Recommendations/ContentView.cs` writes it, i.e. without a full stop.
    await waitFor(() =>
      expect(
        screen.getByText("Recommendations from completed plans will appear here"),
      ).toBeInTheDocument(),
    );
  });
});

describe("RecommendationsView sidebar list", () => {
  it("publishes `recommendations` rows tagged with the source plan and badged as V1 badges them", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "High impact", impact: "High" }),
      rec({ planId: "00022", title: "No impact recorded", impact: undefined }),
    ]);

    renderView();

    await waitFor(() => expect(publishedTitles()).toHaveLength(2));
    const list = sidebarListStore.getState();
    expect(list?.appId).toBe("recommendations");
    expect(list?.title).toBe("Recommendations");
    expect(list?.items[0]).toMatchObject({
      // `RecommendationsApp.RecommendationId`: plan plus title.
      id: "00021::High impact",
      tag: "#21",
      badges: [
        { label: "Tendril-App", kind: "project" },
        { label: "High", kind: "success" },
      ],
    });
    expect(list?.items[1].badges).toEqual([{ label: "Tendril-App", kind: "project" }]);
    // The first row is selected, as `allPending[0]` is in V1, and that titles the page tab.
    expect(list?.selectedId).toBe("00021::High impact");
  });

  it("never lists a recommendation that has already been decided", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "Still pending", state: "Pending" }),
      rec({ planId: "00022", title: "Already declined", state: "Declined" }),
      rec({ planId: "00023", title: "Already accepted", state: "Accepted" }),
    ]);

    renderView();

    // V1's list is `allPending`; a decided recommendation is not something this page can act on.
    await waitFor(() => expect(publishedTitles()).toEqual(["Still pending"]));
    expect(screen.queryByText("Already declined")).not.toBeInTheDocument();
  });

  it("renders no list of its own: the content area is the selected recommendation", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "First one", description: "Its description." }),
      rec({ planId: "00022", title: "Second one" }),
    ]);

    renderView();

    await waitFor(() => expect(publishedTitles()).toHaveLength(2));
    expect(screen.getByTestId("recommendation-title")).toHaveTextContent("#21 First one");
    expect(screen.getByText("Its description.")).toBeInTheDocument();
    // The other recommendation is a sidebar row, not a card on this page.
    expect(screen.queryByText("Second one")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search recommendations/i)).not.toBeInTheDocument();
    // `BuildControls`' "{index}/{count} recommendations".
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("shows the recommendation a sidebar row selects", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "First one" }),
      rec({ planId: "00022", title: "Second one", description: "The second." }),
    ]);

    renderView();
    await waitFor(() => expect(publishedTitles()).toHaveLength(2));

    let args: unknown;
    act(() => {
      args = sidebarListStore.getState()?.buildSelectArgs("00022::Second one");
    });

    expect(args).toEqual({ recommendationId: "00022::Second one" });
    expect(screen.getByTestId("recommendation-title")).toHaveTextContent("#22 Second one");
    expect(sidebarListStore.getState()?.selectedId).toBe("00022::Second one");
  });
});

describe("RecommendationsView actions", () => {
  it("writes Accepted, then starts a CreatePlan job from the description", async () => {
    const list = vi
      .spyOn(bridge, "listCrossPlanRecommendations")
      .mockResolvedValue([rec({ description: "Do the thing." })]);
    const setState = vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "00500", status: "Queued" });
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
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "00501", status: "Queued" });

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
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "nope", status: "Queued" });

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
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "nope", status: "Queued" });

    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(startJob).not.toHaveBeenCalled();
    // Still Pending, so the operator can retry.
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("offers no actions once every recommendation has been decided", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ state: "Declined", declineReason: "Superseded." }),
    ]);

    renderView();

    // `ContentView` only ever renders its Accept/Decline bar for the selected recommendation, and the
    // app only ever selects from the pending set - so a decided one leaves the page with nothing to
    // show and nothing to press.
    await waitFor(() => expect(screen.getByText("No recommendations")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });

  it("moves to the next recommendation after a decision, as `GoToNext` does", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "First one" }),
      rec({ planId: "00022", title: "Second one" }),
    ]);
    vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "00503", status: "Queued" });

    renderView();
    await waitFor(() =>
      expect(screen.getByTestId("recommendation-title")).toHaveTextContent("First one"),
    );

    fireEvent.click(screen.getByTestId("recommendation-accept"));

    // The operator works down the list rather than being thrown back to the top.
    await waitFor(() =>
      expect(screen.getByTestId("recommendation-title")).toHaveTextContent("Second one"),
    );
  });
});

/**
 * Filing a recommendation as a GitHub issue. V2-only: `Apps/Recommendations/` has no issue button,
 * so there is no C# counterpart to check these against. Issue #214.
 */
describe("RecommendationsView create issue", () => {
  const openDialog = async () => {
    renderView({ projects: [{ name: "Tendril-App", repos: ["/repos/tendril"] }] as never });
    await waitFor(() =>
      expect(screen.getByTestId("recommendation-create-issue")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("recommendation-create-issue"));
    await waitFor(() => expect(screen.getByTestId("create-issue-dialog")).toBeInTheDocument());
  };

  it("starts a CreateIssue job carrying the recommendation as the subject", async () => {
    const list = vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "Cache the model list", description: "The catalog refetches every render." }),
    ]);
    const setState = vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "00600", status: "Queued" });

    await openDialog();
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "CreateIssue",
        // The source plan scopes the job; the override is what the issue is about.
        folderPath: "00021",
        repo: "/repos/tendril",
        titleOverride: "Cache the model list",
        bodyOverride: "The catalog refetches every render.",
        // `recommendationId()`, which is also what keeps two recommendations of one plan from
        // colliding on the job's dedupe key.
        issueSource: "00021::Cache the model list",
      }),
    );

    // Filing an issue is not a decision: recommendation state is deliberately untouched, so the
    // row stays Pending and the list is not re-read.
    expect(setState).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("seeds the dialog from the recommendation and lets the wording be fixed first", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([
      rec({ title: "Terse title", description: "Terse body." }),
    ]);
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "00601", status: "Queued" });

    await openDialog();
    expect(screen.getByTestId("create-issue-title")).toHaveValue("Terse title");
    expect(screen.getByTestId("create-issue-body")).toHaveValue("Terse body.");

    fireEvent.change(screen.getByTestId("create-issue-title"), {
      target: { value: "A title someone can act on" },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith(
        expect.objectContaining({ titleOverride: "A title someone can act on" }),
      ),
    );
  });

  it("will not file an issue with no title", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([rec()]);
    const startJob = vi.spyOn(bridge, "startJob");

    await openDialog();
    fireEvent.change(screen.getByTestId("create-issue-title"), { target: { value: "   " } });

    // The plan's own title is not the fallback here, so there would be nothing to name it with.
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();
    expect(startJob).not.toHaveBeenCalled();
  });

  it("offers nowhere to run gh when neither plan nor project records a repo", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([rec()]);

    renderView();
    await waitFor(() =>
      expect(screen.getByTestId("recommendation-create-issue")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("recommendation-create-issue"));

    await waitFor(() =>
      expect(screen.getByTestId("create-issue-no-repos")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();
  });

  it("is unavailable while a decision is in flight", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([rec()]);
    // Never settles, so the accept stays mid-flight for the assertion below.
    vi.spyOn(bridge, "setRecommendationState").mockReturnValue(new Promise(() => {}));

    renderView({ projects: [{ name: "Tendril-App", repos: ["/repos/tendril"] }] as never });
    await waitFor(() =>
      expect(screen.getByTestId("recommendation-accept")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("recommendation-accept"));

    await waitFor(() =>
      expect(screen.getByTestId("recommendation-create-issue")).toBeDisabled(),
    );
  });
});
