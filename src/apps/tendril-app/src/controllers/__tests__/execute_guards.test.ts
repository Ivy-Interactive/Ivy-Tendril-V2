import { describe, it, expect } from "vitest";
import {
  collectExecuteGuards,
  pendingAnnotationCount,
  unansweredQuestions,
} from "../execute_guards";
import type { RepoStatus } from "../../types/api";
import { planDetail } from "../../../tests/fixtures/plan.fixture";

/**
 * A revision body carrying one `questions` fence per entry.
 *
 * The fences are written out rather than generated so the test exercises the
 * same markdown-with-YAML path `extractPlanQuestions` sees in a real revision.
 */
function revisionWith(...blocks: string[]): string {
  return ["# Some Plan", "", "## Problem", "", ...blocks].join("\n");
}

const UNANSWERED = [
  "```questions",
  "questions:",
  "  - id: caching-strategy",
  "    header: Caching",
  "    title: Which caching strategy?",
  "    options:",
  "      - title: In-memory",
  "        value: in-memory",
  "      - title: Redis",
  "        value: redis",
  "```",
].join("\n");

const ANSWERED = [
  "```questions",
  "questions:",
  "  - id: retry-scope",
  "    title: Per-request or per-session retries?",
  "    options:",
  "      - title: Per session",
  "        value: per-session",
  "      - title: Per request",
  "        value: per-request",
  "    answer: per-session",
  "```",
].join("\n");

const OPTIONAL_UNANSWERED = [
  "```questions",
  "questions:",
  "  - id: telemetry-opt-in",
  "    title: Emit telemetry for the new path?",
  "    optional: true",
  "    options:",
  "      - title: Yes",
  "        value: yes-telemetry",
  "      - title: No",
  "        value: no-telemetry",
  "```",
].join("\n");

function repo(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    path: "/repos/Tendril-App",
    isDirty: true,
    changes: [" M src/App.tsx"],
    ...overrides,
  };
}

describe("collectExecuteGuards", () => {
  it("returns nothing for a clean plan", () => {
    const plan = planDetail({
      state: "Draft",
      latestRevisionContent: revisionWith(),
    });

    expect(collectExecuteGuards({ plan })).toEqual([]);
  });

  it("returns nothing when the repos it knows about are all clean", () => {
    const plan = planDetail({ state: "Draft", latestRevisionContent: revisionWith() });

    const guards = collectExecuteGuards({
      plan,
      repoStatus: [repo({ isDirty: false, changes: [] })],
    });

    expect(guards).toEqual([]);
  });

  it("treats an absent repo status as nothing known to be dirty", () => {
    const plan = planDetail({ state: "Draft", latestRevisionContent: revisionWith() });

    expect(collectExecuteGuards({ plan, repoStatus: undefined })).toEqual([]);
  });

  it("orders the guards PendingAnnotations -> UnansweredQuestions -> DirtyRepo", () => {
    // Draft at revision 1 with an answered question is the pending-annotation
    // signal; the unanswered fence beside it fires the second guard.
    const plan = planDetail({
      state: "Draft",
      revisionCount: 1,
      latestRevisionContent: revisionWith(ANSWERED, "", UNANSWERED),
    });

    const guards = collectExecuteGuards({ plan, repoStatus: [repo()] });

    expect(guards.map((g) => g.kind)).toEqual([
      "PendingAnnotations",
      "UnansweredQuestions",
      "DirtyRepo",
    ]);
    expect(guards[0].annotationCount).toBe(1);
    expect(guards[1].questions?.map((q) => q.id)).toEqual(["caching-strategy"]);
    expect(guards[2].dirtyRepos?.map((r) => r.path)).toEqual(["/repos/Tendril-App"]);
  });

  it("ignores questions that already carry an answer", () => {
    const plan = planDetail({
      state: "Review",
      revisionCount: 2,
      latestRevisionContent: revisionWith(ANSWERED),
    });

    expect(unansweredQuestions(plan)).toEqual([]);
    expect(collectExecuteGuards({ plan })).toEqual([]);
  });

  it("ignores optional questions, which are shippable unanswered by definition", () => {
    const plan = planDetail({
      state: "Draft",
      revisionCount: 2,
      latestRevisionContent: revisionWith(OPTIONAL_UNANSWERED),
    });

    expect(unansweredQuestions(plan)).toEqual([]);
    expect(collectExecuteGuards({ plan })).toEqual([]);
  });

  it("only lists dirty repos in the DirtyRepo guard", () => {
    const plan = planDetail({ state: "Draft", latestRevisionContent: revisionWith() });

    const guards = collectExecuteGuards({
      plan,
      repoStatus: [
        repo({ path: "/repos/Clean", isDirty: false, changes: [] }),
        repo({ path: "/repos/Dirty" }),
      ],
    });

    expect(guards).toHaveLength(1);
    expect(guards[0].dirtyRepos?.map((r) => r.path)).toEqual(["/repos/Dirty"]);
  });

  it("lets an explicit annotationCount override the derived one", () => {
    const plan = planDetail({
      state: "Review",
      revisionCount: 4,
      latestRevisionContent: revisionWith(ANSWERED),
    });

    expect(pendingAnnotationCount(plan)).toBe(0);
    expect(collectExecuteGuards({ plan, annotationCount: 3 })).toEqual([
      { kind: "PendingAnnotations", annotationCount: 3 },
    ]);
  });

  it("does not derive annotations once UpdatePlan has written a second revision", () => {
    const plan = planDetail({
      state: "Draft",
      revisionCount: 2,
      latestRevisionContent: revisionWith(ANSWERED),
    });

    expect(pendingAnnotationCount(plan)).toBe(0);
    expect(collectExecuteGuards({ plan })).toEqual([]);
  });

  it("survives a malformed questions fence instead of bricking execution", () => {
    const plan = planDetail({
      state: "Draft",
      revisionCount: 1,
      latestRevisionContent: revisionWith(["```questions", "  : not: yaml: [", "```"].join("\n")),
    });

    expect(unansweredQuestions(plan)).toEqual([]);
    expect(collectExecuteGuards({ plan })).toEqual([]);
  });
});
