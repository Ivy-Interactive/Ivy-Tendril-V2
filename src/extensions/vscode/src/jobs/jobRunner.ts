import * as vscode from "vscode";
import * as cp from "child_process";
import { CONFIG_KEYS } from "../constants";
import { assertIsolatedTendrilHome } from "../server/homeGuard";
import {
  authHeaders,
  discoverMaster,
  padTendrilId,
  resolveTendrilHome,
} from "../server/masterDiscovery";
import { ServerManager } from "../server/serverManager";
import { DiscoveryResult } from "../server/types";

export interface JobStreamEvent {
  kind?: string;
  text?: string;
  delta?: boolean;
  content?: string;
  tool_name?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  output?: string;
  is_error?: boolean;
  message?: string;
  status?: string;
  [key: string]: unknown;
}

export interface JobResult {
  jobId?: string;
  status?: string;
  message: string;
}

export interface JobStatusResult {
  id: string;
  status: string;
  message?: string;
  planId?: string;
}

export interface JobListItem {
  id: string;
  type: string;
  project: string;
  status: string;
  message?: string;
  planId?: string;
  started?: string;
  duration?: string;
}

export interface IJobRunner {
  startCreatePlan(description: string, project?: string): Promise<JobResult>;
  startExecutePlan(planId: string, note?: string): Promise<JobResult>;
  startRetryPlan(planId: string, changeRequest: string): Promise<JobResult>;
  startUpdatePlan(planId: string, instructions: string): Promise<JobResult>;
  getJobStatus(jobId: string): Promise<JobStatusResult>;
  subscribeJobEvents(
    jobId: string,
    onEvent: (event: JobStreamEvent) => void,
    cancellationToken?: vscode.CancellationToken,
    kinds?: string[],
  ): Promise<JobStatusResult>;
  listJobs(): Promise<JobListItem[]>;
  listProjects(): Promise<string[]>;
  executeCli(args: string[]): Promise<{ stdout: string; stderr: string }>;
}

/**
 * Statuses the daemon treats as terminal (`JobStatus` in tendril-core's models/job.rs, and the set
 * `stream_job_events` closes an SSE stream on). Anything else is still in flight and worth polling.
 */
export const TERMINAL_JOB_STATUSES = ["Completed", "Failed", "Stopped", "Timeout"];

export function isTerminalJobStatus(status: string | undefined): boolean {
  return typeof status === "string" && TERMINAL_JOB_STATUSES.includes(status);
}

/** Where the job API lives and what it takes to be let in. */
interface JobApiTarget extends Pick<DiscoveryResult, "secret" | "apiKey"> {
  baseUrl: string;
}

export class JobRunner implements IJobRunner {
  constructor(private readonly serverManager?: ServerManager) {}

  public async executeCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const config = vscode.workspace.getConfiguration();
    const executable = config.get<string>(CONFIG_KEYS.executablePath, "tendril");
    const tendrilHome = this.serverManager
      ? this.serverManager.tendrilHome
      : resolveTendrilHome(config.get<string>(CONFIG_KEYS.homeDirectory));

    assertIsolatedTendrilHome(tendrilHome, `run 'tendril ${args.join(" ")}'`);

    return new Promise((resolve, reject) => {
      cp.execFile(
        executable,
        args,
        {
          env: {
            ...process.env,
            TENDRIL_HOME: tendrilHome,
          },
        },
        (err, stdout, stderr) => {
          if (err) {
            const errorOutput = stderr ? stderr.toString().trim() : "";
            const stdOutput = stdout ? stdout.toString().trim() : "";
            reject(new Error(errorOutput || stdOutput || err.message));
          } else {
            resolve({
              stdout: stdout ? stdout.toString() : "",
              stderr: stderr ? stderr.toString() : "",
            });
          }
        },
      );
    });
  }

  /**
   * Pulls the job id out of `tendril job start`'s confirmation line.
   *
   * V1 printed `Job started: 00458`; V2's `StartOutcome::render` prints `Job started: ID 00458`, and
   * also `Job started: ID 00458 (confirmation was lost; found in the job list)` when it had to
   * reconcile. The optional `ID` keeps both forms working — without it the capture group matched the
   * literal word "ID", and every caller went on to poll a job called "ID".
   */
  private extractJobId(output: string): string | undefined {
    const match = output.match(/Job started:\s*(?:ID\s+)?([^\s\r\n]+)/i);
    return match ? match[1] : undefined;
  }

  public async startCreatePlan(description: string, project?: string): Promise<JobResult> {
    const proj = project || "default";
    const args = [
      "job",
      "start",
      "CreatePlan",
      `--description=${description}`,
      `--project=${proj}`,
    ];
    const { stdout } = await this.executeCli(args);
    const jobId = this.extractJobId(stdout);
    return {
      jobId,
      status: "Started",
      message: stdout.trim(),
    };
  }

  public async startExecutePlan(planId: string, note?: string): Promise<JobResult> {
    const args = ["job", "start", "ExecutePlan", planId];
    if (note) {
      args.push(`--note=${note}`);
    }
    const { stdout } = await this.executeCli(args);
    const jobId = this.extractJobId(stdout);
    return {
      jobId,
      status: "Started",
      message: stdout.trim(),
    };
  }

  public async startRetryPlan(planId: string, changeRequest: string): Promise<JobResult> {
    const args = ["job", "start", "RetryPlan", planId, `--change-request=${changeRequest}`];
    const { stdout } = await this.executeCli(args);
    const jobId = this.extractJobId(stdout);
    return {
      jobId,
      status: "Started",
      message: stdout.trim(),
    };
  }

  public async startUpdatePlan(planId: string, instructions: string): Promise<JobResult> {
    const args = ["job", "start", "UpdatePlan", planId, `--instructions=${instructions}`];
    const { stdout } = await this.executeCli(args);
    const jobId = this.extractJobId(stdout);
    return {
      jobId,
      status: "Started",
      message: stdout.trim(),
    };
  }

  /**
   * `tendril job list --json`, parsed as JSON.
   *
   * V1's CLI spelled this `job list --format json` and printed a hand-rolled flat array, so this
   * call site's `--json` was an unknown option there: every invocation failed and `listJobs`
   * silently returned `[]`, which is why the tab-separated parser it used to have never ran. V2 has
   * a real `--json` flag that pretty-prints the daemon's `JobItem` array, so the fields are read
   * from that: `statusMessage`, `reportedPlanId`, `startedAt` and `durationSeconds` are the V2
   * spellings of what V1's columns carried.
   */
  public async listJobs(): Promise<JobListItem[]> {
    try {
      const { stdout } = await this.executeCli(["job", "list", "--json"]);
      const parsed = JSON.parse(stdout) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((raw): JobListItem => {
        const job = raw as Record<string, unknown>;
        const text = (value: unknown): string | undefined => {
          if (value === null || value === undefined) {
            return undefined;
          }
          const str = String(value).trim();
          return str.length > 0 ? str : undefined;
        };

        return {
          id: text(job.id) ?? "",
          type: text(job.type) ?? "",
          project: text(job.project) ?? "",
          status: text(job.status) ?? "",
          message: text(job.statusMessage),
          // `reportedPlanId` is what the agent told the daemon; `planFile` is the plan folder, whose
          // leading digits are the id when nothing was reported.
          planId: text(job.reportedPlanId) ?? planIdFromFolder(text(job.planFile)),
          started: text(job.startedAt),
          duration: text(job.durationSeconds) ? `${text(job.durationSeconds)}s` : undefined,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * The reachable daemon's base URL plus the credentials for it, or undefined when nothing is
   * serving. The URL comes from the health probe and the credentials from `.master`; a `.master`
   * that cannot be read yields no credentials rather than no target, so an unauthenticated daemon
   * (or a test double) still works and an authenticated one fails with the daemon's own 401.
   */
  private async resolveTarget(): Promise<JobApiTarget | undefined> {
    if (!this.serverManager) {
      return undefined;
    }

    try {
      const health = await this.serverManager.getHealthInfo();
      if (!health.isAlive || !health.baseUrl) {
        return undefined;
      }
      const discovery = discoverMaster(this.serverManager.tendrilHome, false);
      const credentials: Pick<DiscoveryResult, "secret" | "apiKey"> =
        discovery.status === "found"
          ? { secret: discovery.result.secret, apiKey: discovery.result.apiKey }
          : {};
      return { baseUrl: health.baseUrl, ...credentials };
    } catch {
      return undefined;
    }
  }

  public async getJobStatus(jobId: string): Promise<JobStatusResult> {
    // `GET /api/jobs/:id` is `WHERE Id = ?`, an exact match. V1's service padded the id server-side,
    // so "458" resolved; here it has to be padded first or the request 404s.
    const paddedId = padTendrilId(jobId);
    const target = await this.resolveTarget();

    if (target) {
      try {
        const url = `${target.baseUrl.replace(/\/+$/, "")}/api/jobs/${encodeURIComponent(paddedId)}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", ...authHeaders(target) },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            id: string;
            status: string;
            message?: string;
            details?: Record<string, unknown>;
          };
          return {
            id: data.id,
            status: data.status,
            message: data.message,
            // V1 returned the plan id at the top level. V2 nests the whole `JobItem` under
            // `details`, and this is the only place the chat panel can learn which plan a
            // CreatePlan job produced, so its "Next Command" hint depends on reading it.
            planId: planIdFromDetails(data.details),
          };
        }
      } catch {
        // Fall back to listing jobs
      }
    }

    const jobs = await this.listJobs();
    const found = jobs.find((j) => j.id === paddedId || j.id === jobId || j.id.endsWith(jobId));
    if (found) {
      return {
        id: found.id,
        status: found.status,
        message: found.message,
        planId: found.planId,
      };
    }

    return {
      id: paddedId,
      status: "Unknown",
      message: "Job status not found",
    };
  }

  /**
   * Follows a job's SSE event stream to completion and returns its terminal status.
   *
   * Two V2 contract details are load-bearing here:
   *
   * - The daemon names its data frames `event: event` and its terminal frame `event: end`. V1 sent
   *   unnamed frames, which arrive as the default `message` event. A `EventSource` wired to
   *   `onmessage` would therefore receive *nothing* from a V2 daemon and hang until the job ended
   *   rather than erroring, so the frames are parsed by hand below and dispatched on any event name.
   * - No `job.*` event is ever broadcast on the daemon's WebSocket — the only dispatch sites are
   *   `pr_status_changed`, `plan.diff_comments_changed`, `plan.annotations_changed` and the echoed
   *   `status` string. Job lifecycle is available over this SSE stream and by polling
   *   `GET /api/jobs/:id`, and nowhere else, which is why there is no socket path here to add.
   */
  public async subscribeJobEvents(
    jobId: string,
    onEvent: (event: JobStreamEvent) => void,
    cancellationToken?: vscode.CancellationToken,
    kinds?: string[],
  ): Promise<JobStatusResult> {
    const paddedId = padTendrilId(jobId);
    const target = await this.resolveTarget();

    if (!target) {
      return await this.getJobStatus(paddedId);
    }

    const abortController = new AbortController();
    let cancellationListener: vscode.Disposable | undefined;
    if (cancellationToken) {
      if (cancellationToken.isCancellationRequested) {
        abortController.abort();
      } else {
        cancellationListener = cancellationToken.onCancellationRequested(() => {
          abortController.abort();
        });
      }
    }

    let url = `${target.baseUrl.replace(/\/+$/, "")}/api/jobs/${encodeURIComponent(paddedId)}/events`;
    if (kinds && kinds.length > 0) {
      // The daemon reads a comma-separated `?kinds=` *and* repeated `?kind=` pairs; the repeated
      // form is kept because that is what V1 sent.
      const params = new URLSearchParams();
      for (const k of kinds) {
        if (k && k.trim().length > 0) {
          params.append("kind", k.trim());
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...authHeaders(target),
    };

    let finalStatus: string | undefined;

    const parseSseMessage = (message: string) => {
      let eventType = "";
      const dataLines: string[] = [];
      for (const line of message.split(/\r?\n/)) {
        // Comment frames, which is how the daemon's 15s keep-alive arrives.
        if (line.startsWith(":")) {
          continue;
        }
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      const dataStr = dataLines.join("\n");
      if (!dataStr) {
        return;
      }

      try {
        const parsed = JSON.parse(dataStr);
        if (eventType === "end") {
          if (parsed.status) {
            finalStatus = parsed.status;
          }
          onEvent({ kind: "end", status: parsed.status, ...parsed });
        } else {
          if (parsed.status && !finalStatus) {
            finalStatus = parsed.status;
          }
          onEvent(parsed);
        }
      } catch {
        onEvent({ text: dataStr, content: dataStr });
      }
    };

    try {
      const res = await fetch(url, {
        headers,
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        return await this.getJobStatus(paddedId);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let match;
        while ((match = buffer.match(/\r?\n\r?\n/)) !== null && match.index !== undefined) {
          const idx = match.index;
          const message = buffer.slice(0, idx);
          buffer = buffer.slice(idx + match[0].length);
          parseSseMessage(message);
        }
      }

      if (buffer.trim().length > 0) {
        parseSseMessage(buffer);
      }
    } catch {
      // Cancellation and transport failure land in the same place on purpose: either way the job
      // itself is unaffected and its real status has to be re-read rather than guessed.
      return await this.getJobStatus(paddedId);
    } finally {
      cancellationListener?.dispose();
    }

    if (finalStatus) {
      // The `end` frame carries only a status, so the plan id (and the status message) still have to
      // come from the job record.
      const settled = await this.getJobStatus(paddedId);
      return {
        id: paddedId,
        status: finalStatus,
        message: settled.message,
        planId: settled.planId,
      };
    }

    return await this.getJobStatus(paddedId);
  }

  public async listProjects(): Promise<string[]> {
    try {
      const { stdout } = await this.executeCli(["project", "list"]);
      return stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("Error"));
    } catch {
      return [];
    }
  }
}

/** The five-digit plan id at the head of a plan folder name, e.g. `00399-AddDarkMode`. */
function planIdFromFolder(folder: string | undefined): string | undefined {
  if (!folder) {
    return undefined;
  }
  const base =
    folder
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  const match = base.match(/^(\d{1,})(?:-|$)/);
  return match ? padTendrilId(match[1]) : undefined;
}

function planIdFromDetails(details: Record<string, unknown> | undefined): string | undefined {
  if (!details) {
    return undefined;
  }
  const reported = details.reportedPlanId;
  if (typeof reported === "string" && reported.trim().length > 0) {
    return reported.trim();
  }
  const planFile = details.planFile;
  return typeof planFile === "string" ? planIdFromFolder(planFile) : undefined;
}
