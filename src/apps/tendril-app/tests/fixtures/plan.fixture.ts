import type {
  PlanDetail,
  PlanSummary,
  PlanVerification,
  VerificationReport,
} from "../../src/types/api";

/**
 * Typed plan fixtures.
 *
 * These are annotated as `PlanSummary` / `PlanDetail` on purpose: `tsconfig.json`
 * typechecks `tests`, so a field added to or renamed in the DTOs breaks the
 * fixtures at compile time instead of producing tests that silently assert
 * against a shape the bridge no longer returns.
 */
export function planSummary(overrides: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "00021",
    title: "Build Desktop Operator Experience",
    state: "Review",
    project: "Tendril-App",
    level: "Feature",
    priority: 15,
    created: "2026-09-05T18:20:26Z",
    updated: "2026-09-07T10:41:11Z",
    verifications: [
      { name: "RustClippy", status: "Pass" },
      { name: "RustTest", status: "Fail" },
    ],
    ...overrides,
  };
}

export function planDetail(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return {
    ...planSummary(),
    executionProfile: "deep",
    initialPrompt: "Build the operator experience",
    sourceUrl: "https://github.com/SpaceCorps/Tendril-App/issues/7",
    repos: ["/repos/Tendril-App"],
    dependsOn: ["00022-BootstrapTendrilDesktopApplication"],
    relatedPlans: ["00019-CompleteTendrilServiceREST"],
    commits: ["abc1234", "def5678"],
    prs: ["https://github.com/SpaceCorps/Tendril-App/pull/2"],
    latestRevisionContent: "# Build Desktop Operator Experience\n\n## Problem\n",
    folderPath: "/home/op/.tendril/Plans/00021-BuildDesktopOperator",
    revisionCount: 4,
    recommendations: [],
    ...overrides,
  };
}

export function verification(name: string, status: PlanVerification["status"]): PlanVerification {
  return { name, status };
}

export function verificationReport(
  overrides: Partial<VerificationReport> = {},
): VerificationReport {
  return {
    name: "RustTest",
    result: "Fail",
    date: "2026-09-07T10:41:11Z",
    content:
      "---\nresult: Fail\ndate: 2026-09-07T10:41:11Z\n---\n# RustTest\n\n## Output\n\n2 tests failed: dto_mapping, revision_diff\n",
    ...overrides,
  };
}
