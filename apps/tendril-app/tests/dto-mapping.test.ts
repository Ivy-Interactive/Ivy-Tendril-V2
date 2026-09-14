import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { bridge } from "../src/api/bridge";
import type { Job, JobDetail, PlanDetail, PlanSummary, ServiceInfo } from "../src/types/api";
import { planDetail, planSummary } from "./fixtures/plan.fixture";
import { failedJobDetail, job } from "./fixtures/job.fixture";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * The DTO contract lives in `src-tauri/src/service/plan_mapping.rs`: the native
 * side maps the service's snake_case `PlanFile` onto camelCase DTOs, so what
 * arrives in the webview is already camelCase. These tests pin the *webview*
 * half of that contract — the command names and argument shapes the bridge
 * sends, and the fields the views then read.
 *
 * The Rust half (snake_case `PlanFile` in, camelCase DTO out, numeric
 * `metadata.id` zero-padded, priority/executionProfile/recommendations
 * recovered from `yaml_raw`) is pinned by the unit tests in that module.
 */
describe("Plan DTOs over the bridge", () => {
  it("passes the query through to cmd_list_plans and returns typed summaries", async () => {
    const payload: PlanSummary[] = [planSummary()];
    invokeMock.mockResolvedValueOnce(payload);

    const plans = await bridge.listPlans({ status: "Review" });

    expect(invokeMock).toHaveBeenCalledWith("cmd_list_plans", {
      query: { status: "Review" },
    });
    expect(plans[0].id).toBe("00021");
    expect(plans[0].state).toBe("Review");
    expect(plans[0].verifications).toHaveLength(2);
    expect(plans[0].verifications[1].status).toBe("Fail");
  });

  it("carries revisionCount, folderPath and recommendations on PlanDetail", async () => {
    const payload: PlanDetail = planDetail({
      recommendations: [
        {
          title: "Tauri WebDriver E2E Automation",
          description: "Add WebDriver smoke tests.",
          impact: "Medium",
          state: "Pending",
        },
      ],
    });
    invokeMock.mockResolvedValueOnce(payload);

    const detail = await bridge.getPlan("00021");

    expect(invokeMock).toHaveBeenCalledWith("cmd_get_plan", { id: "00021" });
    // These three are the fields the closeout added; without them the Diff
    // View, the Verifications tab and the Review view have nothing to read.
    expect(detail.revisionCount).toBe(4);
    expect(detail.folderPath).toBe("/home/op/.tendril/Plans/00021-BuildDesktopOperator");
    expect(detail.recommendations).toHaveLength(1);
    expect(detail.recommendations[0].state).toBe("Pending");

    expect(detail.dependsOn).toContain("00022-BootstrapTendrilDesktopApplication");
    expect(detail.latestRevisionContent).toContain("# Build Desktop Operator Experience");
    expect(detail.executionProfile).toBe("deep");
    expect(detail.priority).toBe(15);
  });

  it("treats a plan with no recommendations as an empty list, not undefined", async () => {
    invokeMock.mockResolvedValueOnce(planDetail({ recommendations: [], revisionCount: 1 }));

    const detail = await bridge.getPlan("00007");

    expect(detail.recommendations).toEqual([]);
    expect(detail.revisionCount).toBe(1);
  });
});

describe("Job DTOs over the bridge", () => {
  it("returns typed jobs from cmd_list_jobs", async () => {
    const payload: Job[] = [job()];
    invokeMock.mockResolvedValueOnce(payload);

    const jobs = await bridge.listJobs("Running", 10);

    expect(invokeMock).toHaveBeenCalledWith("cmd_list_jobs", {
      status: "Running",
      limit: 10,
    });
    expect(jobs[0].id).toBe("00158");
    expect(jobs[0].planId).toBe("00021");
    expect(jobs[0].status).toBe("Running");
  });

  it("carries reportedFailureReason on JobDetail", async () => {
    const payload: JobDetail = failedJobDetail();
    invokeMock.mockResolvedValueOnce(payload);

    const detail = await bridge.getJob("00158");

    expect(detail.status).toBe("Failed");
    expect(detail.reportedFailureReason).toMatch(/RustTest verification failed/);
  });

  it("accepts Blocked, which the JobStatus union previously omitted", () => {
    // `Blocked` exists in tendril-core's JobStatus; before the closeout the TS
    // union did not list it, so a blocked job was a type error at the boundary.
    const blocked: Job = job({ status: "Blocked" });
    expect(blocked.status).toBe("Blocked");
  });
});

describe("Service DTOs over the bridge", () => {
  it("never exposes the daemon bearer secret to the webview", async () => {
    // cmd_get_service_info is built from ServiceInfoDto, which has no secret
    // field at all; DaemonStatusResponse.secret is #[serde(skip_serializing)].
    const payload: ServiceInfo = {
      state: "Connected",
      tendrilHome: "/home/op/.tendril",
      port: 5010,
      host: "127.0.0.1",
      scheme: "http",
      version: "0.1.0",
      apiVersion: 1,
      pid: 12345,
      capabilities: ["plans", "jobs"],
      message: "Ready",
    };
    invokeMock.mockResolvedValueOnce(payload);

    const info = await bridge.getServiceInfo();

    expect(info.port).toBe(5010);
    expect(info.state).toBe("Connected");
    expect(Object.keys(info)).not.toContain("secret");
    expect((info as unknown as Record<string, unknown>).secret).toBeUndefined();
  });

  it("sends verification report requests with a camelCase planId", async () => {
    invokeMock.mockResolvedValueOnce([]);

    await bridge.listVerificationReports("00021");

    expect(invokeMock).toHaveBeenCalledWith("cmd_list_verification_reports", {
      planId: "00021",
    });
  });

  it("sends recommendation writes with title, state and declineReason", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await bridge.setRecommendationState(
      "00021",
      "Deep Link Protocol Handler",
      "Declined",
      "Not now",
    );

    expect(invokeMock).toHaveBeenCalledWith("cmd_set_recommendation_state", {
      planId: "00021",
      title: "Deep Link Protocol Handler",
      state: "Declined",
      declineReason: "Not now",
    });
  });
});
