import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { ReviewView } from "../src/views/ReviewView";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { bridge } from "../src/api/bridge";
import { planDetail, planGit, planSummary, worktreeSection } from "./fixtures/plan.fixture";
import { recommendation } from "./fixtures/recommendation.fixture";

const reviewPlan = planSummary({
  id: "00021",
  title: "Build Desktop Operator Experience",
  state: "Review",
});

beforeEach(() => {
  sidebarListStore.resetForTesting();
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
  vi.spyOn(bridge, "getPlan").mockResolvedValue(planDetail({ id: "00021" }));
  vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
  vi.spyOn(bridge, "getVerificationReport").mockResolvedValue({
    name: "PreExecution",
    result: "Pass",
    content: "",
  });
  vi.spyOn(bridge, "getPlanSummary").mockResolvedValue("# Plan Summary\nAll tests passed.");
  vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit({ worktrees: [worktreeSection()] }));
  vi.spyOn(bridge, "getPlanChanges").mockResolvedValue({
    files: [
      {
        filePath: "src/main.rs",
        diff: '@@ -1,3 +1,4 @@\n+println!("hello");\n',
        additions: 1,
        deletions: 0,
      },
    ],
    rawDiff: "",
    totalAdditions: 3,
    totalDeletions: 0,
  });
  vi.spyOn(bridge, "getPlanArtifacts").mockResolvedValue({
    screenshots: ["/path/to/screenshot1.png"],
    other: ["/path/to/output.log"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewView tabs", () => {
  it("defaults to Summary tab and renders summary markdown", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-summary")).toBeInTheDocument();
    });
    expect(screen.getByText("All tests passed.")).toBeInTheDocument();
  });

  it("renders fallback note in Summary tab when summary is empty", async () => {
    vi.spyOn(bridge, "getPlanSummary").mockResolvedValue("");

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-summary")).toBeInTheDocument();
    });
    expect(screen.getByText(/No summary is found for this plan/i)).toBeInTheDocument();
  });

  it("can switch to and render Plan tab", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="plan" />);

    const planTab = await screen.findByTestId("review-tab-plan");
    expect(
      within(planTab).getByRole("heading", { name: "Build Desktop Operator Experience" }),
    ).toBeInTheDocument();
  });

  it("can switch to and render Details tab", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="details" />);

    const detailsTab = await screen.findByTestId("review-tab-details");
    expect(within(detailsTab).getByText("00021")).toBeInTheDocument();
    expect(within(detailsTab).getByText("/repos/Tendril-App")).toBeInTheDocument();
    expect(within(detailsTab).getByText("abc1234")).toBeInTheDocument();
  });

  it("can switch to and render Git tab with badge", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="git" />);

    const gitTab = await screen.findByTestId("review-tab-git");
    await waitFor(() => {
      expect(within(gitTab).getByText("Tendril-App")).toBeInTheDocument();
    });
  });

  it("can switch to and render Changes tab with diffs", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="changes" />);

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-changes")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText(/main\.rs/).length).toBeGreaterThan(0);
    });
  });

  it("can switch to and render Artifacts tab with screenshots and other files", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="artifacts" />);

    const artifactsTab = await screen.findByTestId("review-tab-artifacts");
    await waitFor(() => {
      expect(within(artifactsTab).getByText("screenshot1.png")).toBeInTheDocument();
      expect(within(artifactsTab).getByText("output.log")).toBeInTheDocument();
    });
  });

  it("can switch to and render Recommendations tab", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([
      recommendation({ title: "Audit security headers" }),
    ]);

    render(
      <ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="recommendations" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-recommendations")).toBeInTheDocument();
    });
    expect(screen.getByText("Audit security headers")).toBeInTheDocument();
  });

  it("switches tabs when tab items are clicked", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-summary")).toBeInTheDocument();
    });

    // Click Details tab
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    await waitFor(() => {
      expect(screen.getByTestId("review-tab-details")).toBeInTheDocument();
    });

    // Click Plan tab
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    await waitFor(() => {
      expect(screen.getByTestId("review-tab-plan")).toBeInTheDocument();
    });
  });
});

/**
 * The Summary and Plan tabs are inset once, by `PlanMarkdown` itself, exactly as the plan page's
 * document is.
 *
 * `Review/ContentView.cs`: "Summary and Plan are PlanMarkdown, which owns its own scroll, inset and
 * max-width, so neither is wrapped in Cap(): wrapped, each would be inset twice and the two tabs
 * would start their text in different places." Both were wrapped here anyway - an `overflow-y-auto`
 * scroller around a `px-8 py-6` measure cap around the widget - so inside `PlanWorkspace`, where the
 * markdown already pads itself 24px/32px, a review summary started about 67px in and 50px down (the
 * wrapper's 34.56px / 25.92px under the 0.27rem `--spacing` token, on top of the widget's own) against
 * the plan page's 32px and 24px.
 *
 * jsdom has no layout, so these pin the structure that decides it: the tab body is the widget's
 * direct parent, nothing between the workspace and the widget scrolls or pads, and the Review tabs'
 * pane is the plan page's pane.
 */
describe("ReviewView document tabs are inset once, as the plan page's is", () => {
  /** Every element from the widget's root up to (not including) the workspace's content slot. */
  const wrappersOf = (root: Element): Element[] => {
    const chain: Element[] = [];
    for (
      let el = root.parentElement;
      el && !el.classList.contains("pws-content");
      el = el.parentElement
    ) {
      chain.push(el);
    }
    return chain;
  };

  const expectBareDocument = (pane: HTMLElement) => {
    // The tab body is the workspace's content, and the widget sits directly inside it.
    expect(pane.parentElement).toHaveClass("pws-content");
    const root = pane.querySelector(":scope > .pmv-root");
    expect(root).not.toBeNull();
    // Nothing between the two adds a second scroller or a second inset.
    for (const wrapper of wrappersOf(root!)) {
      expect(wrapper.className).not.toMatch(/overflow-(?:y-)?(?:auto|scroll)/);
      expect(wrapper.className).not.toMatch(/(?:^|\s)p[xytrbl]?-\d/);
    }
  };

  it("renders the Summary tab's markdown with no wrapper of its own", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);
    await screen.findByText("All tests passed.");

    expectBareDocument(screen.getByTestId("review-tab-summary"));
  });

  it("renders the Plan tab's markdown with no wrapper of its own", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="plan" />);
    const pane = await screen.findByTestId("review-tab-plan");

    expectBareDocument(pane);
  });

  it("lays the Summary tab out with the same pane as the plan page's Plan tab", async () => {
    vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);

    render(<PlanDetailView plan={planDetail({ id: "00021", state: "Draft" })} />);
    const planPagePane = document.querySelector(".pws-content > *");
    expect(planPagePane?.querySelector(":scope > .pmv-root")).not.toBeNull();
    const planPageClasses = planPagePane!.className;
    cleanup();

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);
    await screen.findByText("All tests passed.");

    expect(screen.getByTestId("review-tab-summary").className).toBe(planPageClasses);
  });

  it("shows the loading line in the document's place, not inside a second inset", () => {
    vi.spyOn(bridge, "getPlanSummary").mockReturnValue(new Promise(() => {}));

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    const pane = screen.getByTestId("review-tab-summary");
    expect(within(pane).getByText("Loading summary…")).toBeInTheDocument();
    expect(pane.querySelector(".pmv-root")).toBeNull();
    expect(pane.parentElement).toHaveClass("pws-content");
  });

  it("leads a failed plan's Plan tab with its callout, beside the document rather than around it", async () => {
    const failed = planSummary({ id: "00021", state: "Failed" });
    vi.spyOn(bridge, "getPlan").mockResolvedValue(planDetail({ id: "00021", state: "Failed" }));

    render(<ReviewView plans={[failed]} onSelectPlan={() => {}} initialTab="plan" />);
    const pane = await screen.findByTestId("review-tab-plan");
    const callout = await within(pane).findByTestId("plan-failure-callout");

    expectBareDocument(pane);
    // The callout's inset wrapper is a sibling that comes before the document, not its parent.
    const root = pane.querySelector(":scope > .pmv-root")!;
    expect(callout.closest(".pmv-root")).toBeNull();
    expect(callout.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The lead is capped and scrolls on its own, so a long failure message cannot squeeze the
    // document below it out of the pane - the document keeps its own scroller either way.
    const lead = pane.firstElementChild!;
    expect(lead).toContainElement(callout);
    expect(lead).toHaveClass("shrink-0", "max-h-[40%]", "overflow-y-auto");
  });
});
