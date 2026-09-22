import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { i18n } from "../src/i18n";
import {
  jobStatusLabel,
  jobTypeLabel,
  planStateLabel,
  useEnumLabels,
} from "../src/i18n/enumLabels";
import common from "../src/locales/en/common.json";
import type { JobStatus, PlanLifecycleState } from "../src/types/api";

/**
 * The daemon's enum values as the UI shows them. In English every label is the value itself, which
 * is what the UI rendered before extraction; every other language translates it; and a value this
 * build has never heard of is shown as it is.
 */

/** Every `JobStatus`, as a record so the compiler fails this file when the union grows. */
const JOB_STATUSES = Object.keys({
  Pending: 1,
  Queued: 1,
  Running: 1,
  Completed: 1,
  Failed: 1,
  Timeout: 1,
  Stopped: 1,
  Blocked: 1,
} satisfies Record<JobStatus, 1>);

/** Every `PlanLifecycleState`, the same way. */
const PLAN_STATES = Object.keys({
  Draft: 1,
  Creating: 1,
  Updating: 1,
  Executing: 1,
  Review: 1,
  Failed: 1,
  Completed: 1,
  Skipped: 1,
  Blocked: 1,
  Icebox: 1,
} satisfies Record<PlanLifecycleState, 1>);

/** Every job type `tendril job start` accepts (`JOB_TYPES` in tendril-cli's job tests). */
const JOB_TYPES = [
  "ExecutePlan",
  "CreatePlan",
  "RetryPlan",
  "UpdatePlan",
  "ExpandPlan",
  "SplitPlan",
  "CreatePr",
  "CreateIssue",
  "SetupProject",
  "AddProject",
  "SyncRepo",
];

beforeAll(async () => {
  // The German catalog is still empty; this stands in for the translation phase. Loaded first, so the
  // real (empty) file cannot replace it on the first switch to German.
  await i18n.loadLanguages(["de"]);
  i18n.addResourceBundle("de", "common", {
    enums: {
      jobStatus: { running: "Läuft" },
      jobType: { executePlan: "Plan ausführen" },
      planState: { icebox: "Eisfach" },
    },
  });
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("enum labels", () => {
  it("are the raw values in English, for every value the daemon has", () => {
    for (const status of JOB_STATUSES) expect(jobStatusLabel(status)).toBe(status);
    for (const type of JOB_TYPES) expect(jobTypeLabel(type)).toBe(type);
    for (const state of PLAN_STATES) expect(planStateLabel(state)).toBe(state);
  });

  it("have exactly one English label per value, keyed by the value in camelCase", () => {
    const camel = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
    expect(Object.keys(common.enums.jobStatus).sort()).toEqual(JOB_STATUSES.map(camel).sort());
    expect(Object.keys(common.enums.jobType).sort()).toEqual(JOB_TYPES.map(camel).sort());
    expect(Object.keys(common.enums.planState).sort()).toEqual(PLAN_STATES.map(camel).sort());
  });

  it("show a value this build does not know as it is, without reporting a missing key", () => {
    // The test setup throws on a missing key, so this also proves no lookup is reported.
    expect(jobStatusLabel("Paused")).toBe("Paused");
    expect(jobTypeLabel("ReviewPlan")).toBe("ReviewPlan");
    expect(planStateLabel("Archived")).toBe("Archived");
    expect(planStateLabel("")).toBe("");
  });

  it("translate in the current language, falling back to English per value", async () => {
    await i18n.changeLanguage("de");
    expect(jobStatusLabel("Running")).toBe("Läuft");
    expect(jobStatusLabel("Failed")).toBe("Failed");
    expect(jobTypeLabel("ExecutePlan")).toBe("Plan ausführen");
    expect(planStateLabel("Icebox")).toBe("Eisfach");
  });

  it("re-render a component, with a new object, when the language changes", async () => {
    const { result } = renderHook(() => useEnumLabels());
    const english = result.current;
    expect(english.jobStatus("Running")).toBe("Running");

    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(result.current).not.toBe(english);
    expect(result.current.jobStatus("Running")).toBe("Läuft");
    expect(result.current.planState("Icebox")).toBe("Eisfach");
    expect(result.current.jobType("SyncRepo")).toBe("SyncRepo");
  });
});
