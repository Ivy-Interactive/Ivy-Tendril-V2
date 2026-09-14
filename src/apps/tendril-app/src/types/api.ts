export type PlanLifecycleState =
  | "Draft"
  | "Creating"
  | "Updating"
  | "Executing"
  | "Review"
  | "Failed"
  | "Completed"
  | "Skipped"
  | "Blocked"
  | "Icebox";

export type VerificationStatus = "Pending" | "Pass" | "Fail" | "Skipped";

export interface PlanVerification {
  name: string;
  status: VerificationStatus;
}

export interface PlanSummary {
  id: string;
  title: string;
  state: PlanLifecycleState;
  project: string;
  level: string;
  priority?: number;
  created?: string;
  updated?: string;
  verifications: PlanVerification[];
}

export interface PlanDetail {
  id: string;
  title: string;
  state: PlanLifecycleState;
  project: string;
  level: string;
  priority?: number;
  executionProfile?: string;
  initialPrompt?: string;
  sourceUrl?: string;
  created?: string;
  updated?: string;
  repos: string[];
  verifications: PlanVerification[];
  dependsOn: string[];
  relatedPlans: string[];
  commits: string[];
  prs: string[];
  latestRevisionContent?: string;
  /** Absolute path of the plan folder, used to locate verification reports. */
  folderPath?: string;
  /** Number of revisions on disk — bounds the Diff View revision selectors. */
  revisionCount: number;
  /** Out-of-scope follow-ups registered by ExecutePlan, read from plan.yaml. */
  recommendations: RecommendationItem[];
}

/** Mirrors `JobStatus` in tendril-core `models/job.rs`. */
export type JobStatus =
  | "Pending"
  | "Queued"
  | "Running"
  | "Completed"
  | "Failed"
  | "Timeout"
  | "Stopped"
  | "Blocked";

export interface Job {
  id: string;
  type: string;
  planId?: string;
  planTitle?: string;
  project: string;
  status: JobStatus;
  statusMessage?: string;
  startedAt?: string;
  completedAt?: string;
  cost?: number;
  tokens?: number;
}

export interface JobDetail extends Job {
  args?: string;
  workingDirectory?: string;
  reportedFailureReason?: string;
}

export interface ServiceHealth {
  status: string;
  isHealthy: boolean;
  port?: number;
  apiVersion?: number;
  capabilities: string[];
}

export interface ServiceInfo {
  state: "Connected" | "Disconnected" | "Unauthenticated" | "NotRunning" | "ForeignMaster";
  tendrilHome: string;
  port?: number;
  host?: string;
  scheme?: string;
  version?: string;
  apiVersion?: number;
  pid?: number;
  capabilities: string[];
  message: string;
  ownership?: "AdoptedExternal" | "Managed";
  statusBadge?: string;
  crashCount?: number;
}

export interface ProjectSummary {
  name: string;
  repos: string[];
  verifications: string[];
}

export interface TendrilConfig {
  codingAgent?: string;
  jobTimeout?: number;
  maxConcurrentJobs?: number;
  planTemplate?: string;
  theme?: string;
  raw?: Record<string, unknown>;
}

export interface StartJobArgs {
  type: string;
  project?: string;
  description?: string;
  folderPath?: string;
  priority?: number;
  note?: string;
  changeRequest?: string;
  instructions?: string;
  [key: string]: unknown;
}

export interface StartJobResponse {
  jobId: string;
  status: string;
}

export interface RevisionResult {
  revision: number;
  message: string;
}

export type RecommendationState = "Pending" | "Accepted" | "AcceptedWithNotes" | "Declined";

export interface RecommendationItem {
  title: string;
  description: string;
  impact?: "Small" | "Medium" | "High";
  state?: RecommendationState;
  declineReason?: string;
}

export interface VerificationReport {
  name: string;
  /** Raw markdown of `<planFolder>/Verification/<name>.md`. */
  content: string;
  /** `result` from the report's YAML frontmatter, when present. */
  result?: VerificationStatus;
  /** `date` from the report's YAML frontmatter, when present. */
  date?: string;
}

export interface PlanQuery {
  status?: string;
  project?: string;
  q?: string;
}

/**
 * Rejection value of every `bridge.*` call. Mirrors `BridgeError` in
 * `src-tauri/src/error.rs`; Tauri serializes a command's `Err` payload
 * verbatim, so the frontend can branch on `code` instead of string-matching.
 */
export interface BridgeError {
  code: string;
  message: string;
  details?: string | null;
}

export function isBridgeError(value: unknown): value is BridgeError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

/** Human-readable text for any bridge rejection, structured or not. */
export function describeBridgeError(err: unknown): string {
  if (isBridgeError(err)) {
    return err.details ? `${err.message} (${err.details})` : err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** `code` of a bridge rejection, or `undefined` for an unstructured one. */
export function bridgeErrorCode(err: unknown): string | undefined {
  return isBridgeError(err) ? err.code : undefined;
}

export interface GitHubUser {
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface GitHubLabel {
  id?: string;
  name: string;
  color: string;
  description?: string;
}

export interface GitHubRepository {
  name: string;
  nameWithOwner: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  author?: GitHubUser;
  assignees: GitHubUser[];
  labels: GitHubLabel[];
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  repository?: GitHubRepository;
  isPullRequest?: boolean;
}

export interface GitHubIssueFilter {
  category?: "my-issues" | "review-requests" | "project-issues";
  repo?: string;
  search?: string;
  labels?: string[];
  assignees?: string[];
  page?: number;
  perPage?: number;
}

export interface GitHubIssuesPage {
  issues: GitHubIssue[];
  totalCount?: number;
  page: number;
  perPage: number;
  hasMore: boolean;
}
