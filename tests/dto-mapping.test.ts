import { describe, it, expect } from "vitest";
import type {
  PlanDetail,
  PlanSummary,
  Job,
  PlanVerification,
  ServiceInfo,
} from "../src/types/api";

describe("DTO Mapping and Serialization", () => {
  it("maps raw plan JSON payload to typed PlanSummary DTO", () => {
    const rawPayload = {
      id: "00042",
      title: "Add Operator Interface",
      state: "Review",
      project: "Tendril-App",
      level: "Feature",
      priority: 1,
      created: "2026-09-06T07:00:00Z",
      updated: "2026-09-06T08:00:00Z",
      verifications: [
        { name: "RustBuild", status: "Pass" },
        { name: "RustTest", status: "Pass" },
      ],
    };

    const summary: PlanSummary = {
      id: rawPayload.id,
      title: rawPayload.title,
      state: rawPayload.state as PlanSummary["state"],
      project: rawPayload.project,
      level: rawPayload.level,
      priority: rawPayload.priority,
      created: rawPayload.created,
      updated: rawPayload.updated,
      verifications: rawPayload.verifications as PlanVerification[],
    };

    expect(summary.id).toBe("00042");
    expect(summary.state).toBe("Review");
    expect(summary.verifications).toHaveLength(2);
    expect(summary.verifications[0].status).toBe("Pass");
  });

  it("maps raw plan file with metadata and revision to PlanDetail DTO", () => {
    const rawPlanFile = {
      metadata: {
        id: "00021",
        title: "Build Desktop Operator",
        state: "Executing",
        project: "Tendril-App",
        level: "Feature",
        repos: ["/Users/rorychatt/repos/Tendril-App"],
        dependsOn: ["00022-BootstrapTendrilDesktopApplication"],
        relatedPlans: ["00019-CompleteTendrilServiceREST"],
        commits: ["abc1234"],
        prs: ["https://github.com/SpaceCorps/Tendril-App/pull/1"],
        verifications: [
          { name: "RustClippy", status: "Pending" },
          { name: "RustBuild", status: "Pending" },
        ],
      },
      latestRevision: "# Plan Specification Content",
    };

    const detail: PlanDetail = {
      id: rawPlanFile.metadata.id,
      title: rawPlanFile.metadata.title,
      state: rawPlanFile.metadata.state as PlanDetail["state"],
      project: rawPlanFile.metadata.project,
      level: rawPlanFile.metadata.level,
      repos: rawPlanFile.metadata.repos,
      dependsOn: rawPlanFile.metadata.dependsOn,
      relatedPlans: rawPlanFile.metadata.relatedPlans,
      commits: rawPlanFile.metadata.commits,
      prs: rawPlanFile.metadata.prs,
      verifications: rawPlanFile.metadata.verifications as PlanVerification[],
      latestRevisionContent: rawPlanFile.latestRevision,
    };

    expect(detail.id).toBe("00021");
    expect(detail.dependsOn).toContain("00022-BootstrapTendrilDesktopApplication");
    expect(detail.latestRevisionContent).toBe("# Plan Specification Content");
  });

  it("maps daemon status response to ServiceInfo DTO while omitting secrets", () => {
    const rawDaemonStatus = {
      state: "Connected",
      tendrilHome: "/home/user/.tendril",
      port: 5010,
      host: "127.0.0.1",
      scheme: "http",
      version: "0.1.0",
      apiVersion: 1,
      pid: 12345,
      capabilities: ["plans", "jobs"],
      message: "Ready",
      secret: "super-secret-token-must-not-leak", // Should not be in ServiceInfo
    };

    const serviceInfo: ServiceInfo = {
      state: rawDaemonStatus.state as ServiceInfo["state"],
      tendrilHome: rawDaemonStatus.tendrilHome,
      port: rawDaemonStatus.port,
      host: rawDaemonStatus.host,
      scheme: rawDaemonStatus.scheme,
      version: rawDaemonStatus.version,
      apiVersion: rawDaemonStatus.apiVersion,
      pid: rawDaemonStatus.pid,
      capabilities: rawDaemonStatus.capabilities,
      message: rawDaemonStatus.message,
    };

    expect(serviceInfo.port).toBe(5010);
    expect(serviceInfo.state).toBe("Connected");
    expect((serviceInfo as Record<string, unknown>).secret).toBeUndefined();
  });

  it("maps JobItem payload to Job DTO", () => {
    const rawJob = {
      id: "00158",
      type: "ExecutePlan",
      reportedPlanId: "00021",
      reportedPlanTitle: "Build Desktop Operator",
      project: "Tendril-App",
      status: "Running",
      statusMessage: "Running verifications...",
      startedAt: "2026-09-06T07:34:52Z",
      cost: 0.12,
      tokens: 45000,
    };

    const job: Job = {
      id: rawJob.id,
      type: rawJob.type,
      planId: rawJob.reportedPlanId,
      planTitle: rawJob.reportedPlanTitle,
      project: rawJob.project,
      status: rawJob.status as Job["status"],
      statusMessage: rawJob.statusMessage,
      startedAt: rawJob.startedAt,
      cost: rawJob.cost,
      tokens: rawJob.tokens,
    };

    expect(job.id).toBe("00158");
    expect(job.type).toBe("ExecutePlan");
    expect(job.planId).toBe("00021");
    expect(job.status).toBe("Running");
  });
});
