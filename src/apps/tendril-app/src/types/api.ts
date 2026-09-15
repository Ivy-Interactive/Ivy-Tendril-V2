/** Team Vault DTOs live in `./vault`, next to the components that own their shape. */
export type * from "./vault";

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
  allocatedPorts?: Record<string, number>;
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
  /** Number of revisions on disk: bounds the Diff View revision selectors. */
  revisionCount: number;
  /** Out-of-scope follow-ups registered by ExecutePlan, read from plan.yaml. */
  recommendations: RecommendationItem[];
  allocatedPorts?: Record<string, number>;
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

export interface ReviewActionConfig {
  name: string;
  condition: string;
  command: string;
  paths?: string[];
}

export interface ProjectSummary {
  name: string;
  repos: string[];
  verifications: string[];
  reviewActions?: ReviewActionConfig[];
}

export interface ProjectDetail extends ProjectSummary {
  color?: string;
  context?: string;
  stackHash?: string;
  buildDependencies?: string[];
}

export interface TendrilConfig {
  codingAgent?: string;
  jobTimeout?: number;
  maxConcurrentJobs?: number;
  planTemplate?: string;
  theme?: string;
  inbox?: InboxConfig;
  raw?: Record<string, unknown>;
}

/**
 * Assigned-issue auto-import settings. `autoAcceptAssignedIssues` selects what a
 * swept issue becomes — a plan-creation job when true, a proposal awaiting a
 * human when false — it does not turn the importer off. A
 * `checkIntervalMinutes` of `0` or less is what disables it.
 */
export interface InboxConfig {
  autoAcceptAssignedIssues?: boolean;
  checkIntervalMinutes?: number;
}

export type ProposalState = "Pending" | "Accepted" | "Dismissed";

/**
 * An assigned GitHub issue the importer swept. The row survives every decision,
 * `Dismissed` included: that record is what stops the next sweep from
 * re-importing an issue the user said no to.
 */
export interface InboxProposal {
  id: number;
  number: number;
  repository: string;
  title: string;
  body: string;
  issueUrl: string;
  project: string;
  state: ProposalState;
  jobId?: string;
  discovered: string;
  updated: string;
}

export type SweepOutcome = "Ran" | "NotMaster" | "AlreadyRunning";

/** What one import pass did. Per-project failures land in `errors` and are never fatal. */
export interface SweepReport {
  imported: InboxProposal[];
  accepted: number;
  skipped: number;
  errors: string[];
  outcome: SweepOutcome;
}

/** Why the first-run wizard is (or is not) needed; mirrors `onboarding::OnboardingReason`. */
export type OnboardingReason =
  | "FreshInstall"
  | "NoProjects"
  | "AlreadyConfigured"
  | "Completed"
  | "Dismissed";

export interface OnboardingStatus {
  needed: boolean;
  reason: OnboardingReason;
  projectCount: number;
  configExists: boolean;
  tendrilHome: string;
}

export type DoctorCheckStatus = "Ok" | "Warn" | "Fail";

export type DoctorCheckCategory = "Prerequisite" | "Environment";

/** One health probe from the `tendril-core` registry that `tendril doctor` also prints. */
export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  message: string;
  required: boolean;
  installUrl?: string | null;
  category: DoctorCheckCategory;
}

export interface CreateProjectRequest {
  name: string;
  color?: string;
  repos?: string[];
}

export type ModelCatalogSource = "models.dev" | "static";

export interface ModelCatalogStatus {
  source: ModelCatalogSource;
  totalModelCount: number;
  dynamicModelCount: number;
  staticModelCount: number;
  enrichModels: boolean;
  cachedAt: string | null;
  cachePath: string;
}

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  lastChecked: string | null;
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

/**
 * Uncommitted-change status of one repo a plan targets, from
 * `cmd_get_repo_status`. A repo that could not be inspected carries `error` and
 * `isDirty: false`, so the dirty-repo guard treats "unknown" as "not blocking".
 */
export interface RepoStatus {
  path: string;
  isDirty: boolean;
  /** `git status --porcelain` lines, capped by the service. */
  changes: string[];
  /** Total changed entries, which may exceed `changes.length`. */
  changeCount?: number;
  error?: string;
}

/**
 * The Git tab's shapes, from `cmd_get_plan_git`.
 *
 * `PlanGitView` in the components package owns these declarations, because it is
 * the component that renders them and it cannot import from the app. Re-exported
 * here so the rest of the app keeps reaching for its types in one place.
 *
 * `unreachable` and `missing` are lost work: the commit's worktree and branch are
 * gone, so nothing but the object store is keeping it, and the next `git gc` in
 * that repo prunes it. Commits listed under a worktree section are ancestors of
 * that worktree's HEAD and so reachable by definition; only the unassociated ones
 * carry a status, because those are the ones that can be reachable from nothing.
 */
export type {
  CommitRefStatus,
  PlanCommitRow,
  PlanWorktreeSection,
  PlanGitData,
} from "@ivy-interactive/components/tendril";

/** Options the Create PR dialog passes through to the `CreatePr` job. */
export interface CreatePrOptions {
  solveMergeConflicts?: boolean;
  merge?: boolean;
  deleteBranch?: boolean;
  includeArtifacts?: boolean;
  draft?: boolean;
  reviewers?: string[];
  comment?: string;
}

/** Fields the Create Issue dialog collects for the `CreateIssue` job. */
export interface CreateIssueFields {
  repo: string;
  assignee?: string;
  comment?: string;
  labels?: string[];
}

export interface RevisionResult {
  revision: number;
  message: string;
}

/**
 * One inline diff comment, mirroring `DraftCommentDto` in `src-tauri/src/models.rs` and
 * `PlanDiffView`'s own `DraftComment`, so a comment passes between them without translation.
 *
 * `filePath` is the anchor: `plan.md@<old>-<new>` scopes a comment to one revision pair, while a
 * bare `plan.md` is what the original Tendril wrote and stays readable.
 */
export interface DraftComment {
  filePath: string;
  changeKey: string;
  content: string;
  lineNumber: number;
  author?: string;
  isResolved?: boolean;
}

export type RecommendationState = "Pending" | "Accepted" | "AcceptedWithNotes" | "Declined";

export interface RecommendationItem {
  title: string;
  description: string;
  impact?: "Small" | "Medium" | "High";
  state?: RecommendationState;
  /** Why the recommendation was declined. Only set for `Declined`. */
  declineReason?: string;
  /** Why the recommendation was accepted. Only set for `AcceptedWithNotes`. */
  notes?: string;
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

/** `Unknown` means the daemon could not resolve the PR, never that it is open. */
export type PrState = "Open" | "Closed" | "Merged" | "Unknown";

/** One tracked pull request, as of the daemon's last reconciliation pass. */
export interface PrStatus {
  prUrl: string;
  owner: string;
  repo: string;
  number: number;
  status: PrState;
  branch?: string | null;
  /** `null` until the PR has been through one pass. */
  lastChecked?: string | null;
  planId: string;
  planFolder: string;
  planTitle: string;
  project: string;
  /** `SUM(Cost)` over the plan's cost rows; `0` when the plan has none or none is priceable. */
  cost: number;
  /** `SUM(Tokens)` over the plan's cost rows; `0` when the plan has none. */
  tokens: number;
}

export interface PrTransition {
  prUrl: string;
  from?: PrState | null;
  to: PrState;
}

export interface PrSyncReport {
  tracked: number;
  checked: number;
  skippedMerged: number;
  skippedFresh: number;
  transitions: PrTransition[];
  completedPlans: string[];
  refusedCompletions: string[];
  unblockedPlans: string[];
  errors: string[];
  changed: boolean;
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
