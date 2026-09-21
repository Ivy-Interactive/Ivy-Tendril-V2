import {
  CreateIssueDialog,
  CreatePrDialog,
  UpdatePlanDialog,
  SuggestChangesDialog,
} from "../../dialogs";
import { defineSurface } from "./types";
import { plan } from "./models";
import type { Job } from "../../../types/api";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "1184",
    type: "ExecutePlan",
    planId: "00412",
    project: "Ivy-Tendril-V2",
    status: "Running",
    ...overrides,
  };
}

/**
 * The four dialogs that start a job.
 *
 * Each collects arguments for a promptware and dispatches, so their scenarios are about the shape
 * of what the operator is choosing from: which repos exist, which toggles are set, what is already
 * running. None of them reaches the daemon to *render* - only to submit - so every scenario here
 * mounts against the real component with no seam.
 */

export const createIssueSurface = defineSurface("CreateIssueDialog", "dialog", CreateIssueDialog, [
  {
    title: "Plan mode · several repos",
    hint: "The default. `repo` is a local repository path, not an `owner/name` slug, which is why it is a select over the plan's repos rather than a text box.",
    props: {
      plan: plan({ repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework"] }),
    },
    expectText: ["/repos/Ivy-Tendril-V2"],
  },
  {
    title: "Plan mode · falls back to project repos",
    hint: "A plan recording no repos of its own takes `projectRepos`.",
    props: {
      plan: plan({ repos: [] }),
      projectRepos: ["/repos/FromProject"],
    },
    expectText: ["/repos/FromProject"],
  },
  {
    title: "Plan mode · no repos anywhere",
    hint: "Neither the plan nor the project has one, so there is nothing to run `gh` in. The empty select is the case that must not read as a working form.",
    props: { plan: plan({ repos: [] }) },
  },
  {
    title: "Plan mode · many repos",
    hint: "Six repos: whether the select stays usable, and which one is preselected.",
    props: {
      plan: plan({
        repos: [
          "/repos/Ivy-Tendril-V2",
          "/repos/Ivy-Framework",
          "/repos/Ivy-Tendril",
          "/repos/Ivy-Services",
          "/repos/Ivy-Mcp",
          "/repos/Ivy-Cdn",
        ],
      }),
    },
    expectText: ["/repos/Ivy-Mcp"],
  },
  {
    title: "Subject mode · from a recommendation",
    hint: "Supplying a `subject` switches the dialog into subject mode, where Title and Body become editable fields seeded from it. The plan is then the *source* plan, still resolving the repo list and job scope.",
    props: {
      plan: plan(),
      subject: {
        title: "Extract the duplicated worktree path resolver",
        body: "`resolve_working_directory` and `WorktreePathHelper` compute the same path two ways.",
        source: "00412::Extract the duplicated worktree path resolver",
        kind: "recommendation",
      },
    },
    expectText: ["Extract the duplicated worktree path resolver"],
  },
  {
    title: "Subject mode · long body",
    hint: "The body is seeded into a textarea. A long one is the case where the dialog either scrolls or grows past the viewport.",
    props: {
      plan: plan(),
      subject: {
        title: "Wireframe leak guard misses copied CSS",
        body: [
          "The guard inspects tsx/ts/jsx/js/css/html and claims a whole-file copy only above five",
          "meaningful lines. A short stylesheet lifted verbatim from a wireframe therefore passes.",
          "",
          "Repro: scaffold a wireframe, copy its `tokens.css` into the product tree, execute.",
          "Expected: the plan fails its wireframe check. Actual: it completes and the PR carries it.",
        ].join("\n"),
        source: "00412::Wireframe leak guard misses copied CSS",
        kind: "recommendation",
      },
    },
    expectText: ["Wireframe leak guard misses copied CSS"],
  },
  {
    title: "Subject mode · title with markup characters",
    hint: "A subject is operator- or agent-written prose, so backticks and angle brackets reach the field as literals and must not be interpreted.",
    props: {
      plan: plan(),
      subject: {
        title: "`resolve_agent` returns <none> for a stale catalog entry",
        body: "Reproduced against a catalog written before the provider rename.",
        source: "00412::resolve_agent returns none",
        kind: "recommendation",
      },
    },
    expectText: ["resolve_agent"],
  },
  {
    title: "Subject mode · no repos",
    hint: "Subject mode with nothing to run `gh` in — the two independent empty branches meeting.",
    props: {
      plan: plan({ repos: [] }),
      subject: {
        title: "Dedupe key ignores the subject",
        body: "Two recommendations from one plan collapse onto the same job.",
        source: "00412::Dedupe key ignores the subject",
        kind: "recommendation",
      },
    },
    expectText: ["Dedupe key ignores the subject"],
  },
]);

export const createPrSurface = defineSurface("CreatePrDialog", "dialog", CreatePrDialog, [
  {
    title: "Review plan · defaults",
    hint: "The five toggles at their defaults, which is what most dispatches send.",
    props: { plan: plan({ state: "Review" }) },
  },
  {
    title: "Plan with commits",
    hint: "A plan with work to open a PR for: the ordinary case the dialog exists to serve.",
    props: {
      plan: plan({
        state: "Review",
        commits: ["a1b2c3d Add the registry", "e4f5g6h Add the contract runner"],
      }),
    },
  },
  {
    title: "Plan with an existing PR",
    hint: "A second PR on a plan that already has one — whether the dialog says so before dispatching.",
    props: {
      plan: plan({
        state: "Review",
        prs: ["https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/241"],
      }),
    },
  },
  {
    title: "Multi-repo plan",
    hint: "Three repos means three PRs, and the toggles apply to all of them.",
    props: {
      plan: plan({
        state: "Review",
        repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework", "/repos/Ivy-Tendril"],
      }),
    },
  },
  {
    title: "Plan with no repos",
    hint: "Nothing to open a PR against.",
    props: { plan: plan({ state: "Review", repos: [] }) },
  },
  {
    title: "Completed plan",
    hint: "A plan already shipped. V1 offers the dialog anyway, so the copy has to hold.",
    props: { plan: plan({ state: "Completed" }) },
  },
  {
    title: "Plan with failed verifications",
    hint: "Opening a PR from a plan whose checks did not pass, which the verification gate allows but the reviewer should see.",
    props: {
      plan: plan({
        state: "Review",
        verifications: [
          { name: "RustClippy", status: "Fail" },
          { name: "NpmTest", status: "Pass" },
        ],
      }),
    },
  },
]);

export const updatePlanSurface = defineSurface("UpdatePlanDialog", "dialog", UpdatePlanDialog, [
  {
    title: "No jobs",
    hint: "The base case: nothing is running, so nothing is warned about.",
    props: { plan: plan(), planJobs: [] },
  },
  {
    title: "UpdatePlan already running",
    hint: "V1's warning. A convenience rather than the authority — the service refuses a second UpdatePlan on the same folder either way.",
    props: {
      plan: plan(),
      planJobs: [job({ type: "UpdatePlan", status: "Running" })],
    },
  },
  {
    title: "A different job running",
    hint: "ExecutePlan is running, which is not what the warning is about. The check must be type-specific, not any-job.",
    props: {
      plan: plan({ state: "Executing" }),
      planJobs: [job({ type: "ExecutePlan", status: "Running" })],
    },
  },
  {
    title: "UpdatePlan finished",
    hint: "A completed UpdatePlan is not a running one, so the warning must not fire on history.",
    props: {
      plan: plan(),
      planJobs: [job({ type: "UpdatePlan", status: "Completed" })],
    },
  },
  {
    title: "planJobs absent",
    hint: "Without the list the dialog cannot tell, and must not claim either way.",
    props: { plan: plan() },
  },
  {
    title: "Plan with an initial prompt",
    hint: "UpdatePlan refines an existing draft, so a plan carrying its original prompt is the realistic input.",
    props: {
      plan: plan({
        initialPrompt: "Give every dialog a scenario catalog and render it two ways.",
      }),
      planJobs: [],
    },
  },
]);

export const suggestChangesSurface = defineSurface(
  "SuggestChangesDialog",
  "dialog",
  SuggestChangesDialog,
  [
    {
      title: "Empty request",
      hint: "Nothing typed and no comments: the case where submitting has nothing to send.",
      props: { plan: plan({ state: "Review" }) },
    },
    {
      title: "Prefilled draft",
      hint: "`initialChangeRequest` is a draft put in front of the reviewer, not a dispatch — so it is editable.",
      props: {
        plan: plan({ state: "Review" }),
        initialChangeRequest: "The registry should assert completeness against the barrel.",
      },
      expectText: ["assert completeness"],
    },
    {
      title: "One unresolved inline comment",
      hint: "`inlineCommentCount` drives the callout, the submit label, and whether an empty field may still be submitted.",
      props: { plan: plan({ state: "Review" }), inlineCommentCount: 1 },
    },
    {
      title: "Several unresolved inline comments",
      hint: "The plural half of that same copy.",
      props: { plan: plan({ state: "Review" }), inlineCommentCount: 7 },
    },
    {
      title: "App comments · one page",
      hint: "Supplying `appComments` makes this V1's `UpdateFromCommentsDialog` instead: a different header and a read-only listing grouped by page.",
      props: {
        plan: plan({ state: "Review" }),
        appUrl: "http://127.0.0.1:5173/",
        appComments: [
          {
            id: "c1",
            number: 1,
            tag: "button",
            selector: "#save",
            comment: "This should say Publish, not Save.",
            url: "http://127.0.0.1:5173/settings",
          },
        ],
      },
    },
    {
      title: "App comments · several pages",
      hint: "Grouping: comments from three pages, one of which carries no `url` and belongs to the entry URL.",
      props: {
        plan: plan({ state: "Review" }),
        appUrl: "http://127.0.0.1:5173/",
        appComments: [
          {
            id: "c1",
            number: 1,
            tag: "button",
            selector: "#save",
            comment: "This should say Publish.",
            url: "http://127.0.0.1:5173/settings",
          },
          {
            id: "c2",
            number: 2,
            tag: "table",
            selector: ".jobs",
            comment: "Sort by start time, not id.",
            url: "http://127.0.0.1:5173/jobs",
          },
          {
            id: "c3",
            number: 3,
            tag: "h1",
            selector: "h1",
            comment: "Heading is the wrong size here.",
          },
        ],
      },
    },
    {
      title: "App comments · long comment text",
      hint: "A comment written as prose rather than a phrase, which is what reviewers actually leave.",
      props: {
        plan: plan({ state: "Review" }),
        appUrl: "http://127.0.0.1:5173/",
        appComments: [
          {
            id: "c1",
            number: 1,
            tag: "form",
            selector: "form.levels",
            comment:
              "The badge field is preserved through an edit but never shown, so there is no way to tell from this screen whether a level has one. Either surface it read-only or make it editable, but the current state is invisible either way.",
          },
        ],
      },
    },
  ],
);
