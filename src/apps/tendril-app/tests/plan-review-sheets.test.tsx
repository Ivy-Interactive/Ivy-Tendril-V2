import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ReviewView } from "../src/views/ReviewView";
import { planLinkTarget } from "../src/views/planDetail/planLinks";
import { sharePlan } from "../src/views/planDetail/share";
import { tunnelApi } from "../src/api/tunnelApi";
import { bridge } from "../src/api/bridge";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { planDetail, planGit, planSummary } from "./fixtures/plan.fixture";
import { job, jobDetail } from "./fixtures/job.fixture";

/*
 * The Review/Plan sheets this port wires: the commit detail sheet (Git and Details tabs), the file
 * sheet (local links in the plan document), and the job sheets (the Details tab's Jobs section).
 */

const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: () => Promise.resolve(),
  openPath: () => Promise.resolve(),
  openUrl: (url: string) => openUrl(url),
}));

const PLAN_FOLDER = "/home/op/.tendril/Plans/00021-BuildDesktopOperator";
const reviewPlan = planSummary({ id: "00021", title: "Build Desktop Operator Experience" });

beforeEach(() => {
  openUrl.mockClear();
  sidebarListStore.resetForTesting();
  vi.spyOn(bridge, "getPlan").mockResolvedValue(
    planDetail({
      id: "00021",
      folderPath: PLAN_FOLDER,
      latestRevisionContent: `# Plan\n\nSee [the view](file://${PLAN_FOLDER}/notes.ts) and [the issue](https://example.com/7).`,
    }),
  );
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
  vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
  vi.spyOn(bridge, "getPlanSummary").mockResolvedValue("# Summary");
  vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
  vi.spyOn(bridge, "getPlanChanges").mockResolvedValue({
    files: [],
    rawDiff: "",
    totalAdditions: 0,
    totalDeletions: 0,
  });
  vi.spyOn(bridge, "getPlanArtifacts").mockResolvedValue({ screenshots: [], other: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const commit = {
  hash: "abc1234000000000000000000000000000000000",
  title: "Add the plan Git tab",
  repository: "/repos/Tendril-App",
  files: [{ status: "M", path: "src/views/ReviewView.tsx" }],
  changes: [],
  totalAdditions: 0,
  totalDeletions: 0,
};

describe("commit detail sheet", () => {
  it("opens from a commit in the Git tab", async () => {
    const getCommit = vi.spyOn(bridge, "getPlanCommit").mockResolvedValue(commit);

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="git" />);

    fireEvent.click(await screen.findByTestId("git-commit-abc1234"));

    const sheet = await screen.findByTestId("commit-detail-sheet");
    expect(getCommit).toHaveBeenCalledWith("00021", commit.hash);
    expect(
      await within(sheet).findByRole("heading", { name: "Commit abc1234 — Add the plan Git tab" }),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("src/views/ReviewView.tsx")).toBeInTheDocument();
  });

  it("opens from a commit in the Details tab, and says when no repo holds it", async () => {
    vi.spyOn(bridge, "getPlanCommit").mockResolvedValue(null);

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="details" />);

    fireEvent.click(await screen.findByTestId("details-commit-def5678"));

    const sheet = await screen.findByTestId("commit-detail-sheet");
    expect(await within(sheet).findByTestId("commit-sheet-not-found")).toBeInTheDocument();
  });
});

describe("file sheet", () => {
  it("opens a local link in the plan document instead of navigating the webview", async () => {
    const getFile = vi
      .spyOn(bridge, "getPlanFileContent")
      .mockResolvedValue({ kind: "text", text: "export const x = 1;", size: 19 });

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="plan" />);

    // A web link goes to the system browser, and the page stays put.
    expect(fireEvent.click(await screen.findByRole("link", { name: "the issue" }))).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/7");
    expect(screen.queryByTestId("file-sheet")).not.toBeInTheDocument();

    expect(fireEvent.click(screen.getByRole("link", { name: "the view" }))).toBe(false);

    const sheet = await screen.findByTestId("file-sheet");
    expect(getFile).toHaveBeenCalledWith("00021", `${PLAN_FOLDER}/notes.ts`);
    expect(within(sheet).getByRole("heading", { name: "notes.ts" })).toBeInTheDocument();
    expect(await within(sheet).findByText("export const x = 1;")).toBeInTheDocument();
  });
});

describe("job sheets", () => {
  it("opens Job Debug and Cost & Tokens from the Details tab's Jobs section", async () => {
    const getJob = vi.spyOn(bridge, "getJob").mockResolvedValue(jobDetail({ id: "00158" }));
    // Finished jobs: a running one would hold the plan and take it off the review queue.
    const jobs = [
      job({ id: "00158", planId: "00021", status: "Completed" }),
      job({ id: "00999", planId: "00007", status: "Completed" }),
    ];

    render(
      <ReviewView plans={[reviewPlan]} jobs={jobs} onSelectPlan={() => {}} initialTab="details" />,
    );

    const section = await screen.findByTestId("plan-jobs");
    // Only the plan's own jobs.
    expect(within(section).getByTestId("plan-job-00158")).toBeInTheDocument();
    expect(within(section).queryByTestId("plan-job-00999")).not.toBeInTheDocument();

    fireEvent.click(within(section).getByTestId("plan-job-debug-00158"));
    const debug = await screen.findByTestId("job-debug-sheet");
    expect(getJob).toHaveBeenCalledWith("00158");
    expect(await within(debug).findByTestId("job-debug-fields")).toBeInTheDocument();
    fireEvent.click(within(debug).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("job-debug-sheet")).not.toBeInTheDocument());

    fireEvent.click(within(section).getByTestId("plan-job-tokens-00158"));
    expect(await screen.findByTestId("job-cost-sheet-panel")).toBeInTheDocument();
  });
});

describe("planLinkTarget", () => {
  it("routes V1's link kinds", () => {
    expect(planLinkTarget("plan://21")).toEqual({ kind: "plan", planId: "00021" });
    expect(planLinkTarget("https://example.com")).toEqual({
      kind: "external",
      url: "https://example.com",
    });
    expect(planLinkTarget("file:///C:/Repos/app/src/a.ts#L12")).toEqual({
      kind: "file",
      path: "C:/Repos/app/src/a.ts",
    });
    expect(planLinkTarget("/repos/app/README.md")).toEqual({
      kind: "file",
      path: "/repos/app/README.md",
    });
    expect(planLinkTarget("#problem")).toEqual({ kind: "anchor", id: "problem" });
  });

  it("resolves a relative link against the plan folder, and drops it without one", () => {
    expect(planLinkTarget("Artifacts/summary.md", PLAN_FOLDER)).toEqual({
      kind: "file",
      path: `${PLAN_FOLDER}/Artifacts/summary.md`,
    });
    expect(planLinkTarget("Artifacts/summary.md")).toBeNull();
  });
});

describe("sharePlan", () => {
  it("copies the link when a share tunnel is up, and opens the dialog otherwise", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const openDialog = vi.fn();

    vi.spyOn(tunnelApi, "getShareTunnel").mockResolvedValueOnce({
      kind: "share",
      status: "connected",
      url: "https://abc.trycloudflare.com",
      shareToken: "tok",
      installed: true,
      sharePort: 5010,
    } as Awaited<ReturnType<typeof tunnelApi.getShareTunnel>>);
    await sharePlan("00021", true, openDialog);
    expect(openDialog).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(
      "https://abc.trycloudflare.com/review?planId=00021&share=1&shareToken=tok",
    );

    vi.spyOn(tunnelApi, "getShareTunnel").mockResolvedValueOnce({
      kind: "share",
      status: "disabled",
      installed: true,
      sharePort: 5010,
    } as Awaited<ReturnType<typeof tunnelApi.getShareTunnel>>);
    await sharePlan("00021", false, openDialog);
    expect(openDialog).toHaveBeenCalledTimes(1);
  });
});
