import type { Job, JobDetail } from "../../src/types/api";

export function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "00158",
    type: "ExecutePlan",
    planId: "00021",
    planTitle: "Build Desktop Operator Experience",
    project: "Tendril-App",
    status: "Running",
    statusMessage: "Running verifications...",
    startedAt: "2026-09-07T07:34:52Z",
    cost: 0.12,
    tokens: 45000,
    ...overrides,
  };
}

export function jobDetail(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    ...job(),
    args: '{"type":"ExecutePlan","folderPath":"00021"}',
    workingDirectory: "/repos/Tendril-App",
    ...overrides,
  };
}

/** A job the promptware itself reported as failed, with its stated reason. */
export function failedJobDetail(overrides: Partial<JobDetail> = {}): JobDetail {
  return jobDetail({
    status: "Failed",
    completedAt: "2026-09-07T08:10:00Z",
    reportedFailureReason:
      "RustTest verification failed after 3 attempts: 2 tests still failing.",
    ...overrides,
  });
}
