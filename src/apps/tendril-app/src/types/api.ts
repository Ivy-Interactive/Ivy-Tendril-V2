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

export interface ChangedFile {
  filePath: string;
  diff: string;
  additions: number;
  deletions: number;
}

export interface PlanChangesData {
  files: ChangedFile[];
  rawDiff: string;
  totalAdditions: number;
  totalDeletions: number;
  repository?: string;
}

export interface PlanArtifacts {
  screenshots: string[];
  other: string[];
}

/**
 * One file in a plan's `Artifacts/` folder, as the Review app's artifact sheet shows it. Mirrors
 * `tendril_core::plans::PlanArtifactContent`: only `text` carries content, and `binary` / `tooLarge`
 * say why there is none (the daemon does not read a file past its 1 MiB preview cap).
 */
export type PlanArtifactContent =
  | { kind: "text"; text: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number };

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
  /**
   * What the operator actually asked for, in their own words, when the daemon could say — a
   * `CreatePlan`'s description, a `RetryPlan`'s change request, an `ExecutePlan`'s note, and so on.
   *
   * The third link in V1's `GetPromptDisplay` chain (`JobsApp.Helpers.cs:139`), which walks the plan's
   * title, then `ReportedPlanTitle`, then the job's typed args. V2's chain stopped at the second link,
   * so a `CreatePlan` imported from the Inbox — whose description *is* the whole request and whose
   * plan does not exist until the agent has run — showed an empty Prompt cell for its entire run.
   *
   * Absent for a job type that carries no prose of its own (`ExpandPlan`, `SplitPlan`).
   */
  prompt?: string;
  project: string;
  status: JobStatus;
  statusMessage?: string;
  startedAt?: string;
  completedAt?: string;
  /**
   * When the agent last wrote a line, RFC 3339. The Jobs table's Agent Output column is the time
   * since this rather than a status line (`JobsApp.Helpers.cs` `FormatAgentOutput`), and absent means
   * a job that has not said anything yet — which is what V1 renders as "Starting...".
   *
   * The daemon stamps it at most once every five seconds however loud the agent is, so it lags real
   * output by up to that much. Invisible in a cell whose smallest unit is a second.
   */
  lastOutputAt?: string;
  /**
   * The chat conversation this job was started from, when one was. The chat header lists a
   * conversation's jobs by this, so the header is correct on a reload and after a missed
   * `chat.job_spawned` — the session's own `spawnedJobIds` is a cache over the same fact.
   */
  chatSessionId?: string;
  cost?: number;
  tokens?: number;
  processId?: number;
  /**
   * Set once this job's `Running` row was restored across a daemon restart with its process still
   * alive: it survived the restart but a previous session's daemon is no longer the one watching it.
   * Absent (rather than `false`) for every job that never went through recovery.
   */
  detached?: boolean;
  /**
   * The agent's own figure when it reported one (`"agent"`), otherwise ours (`"estimated"`).
   * Absent means neither, which is not the same as a cost of zero: a run on a subscription plan
   * reports tokens and no charge.
   */
  costSource?: string;
  durationSeconds?: number;
  /**
   * The usage breakdown. `cacheReadTokens` dominates the bill on any long run, so a UI that shows
   * only `tokens` understates it by an order of magnitude.
   */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  model?: string;
}

export interface JobDetail extends Job {
  /** What the agent asked to do and was refused. Detail only. */
  permissionDenials?: string[];
  args?: string;
  workingDirectory?: string;
  reportedFailureReason?: string;
  /** Which agent ran it (`claude`, `codex`, …). V1's `Provider`. */
  provider?: string;
  /** The command line the agent was launched with. V1's `CliCommand`, labelled `Arguments` there. */
  cliCommand?: string;
  /** Which execution profile the run used. V1's `Profile` row in the Cost & Tokens sheet. */
  executionProfile?: string;
  /** The plan folder the job ran against. V1's `PlanFolder`. */
  planFolder?: string;
  /** The artifacts the run left on this machine, each present only when the file exists. */
  jobLogPath?: string;
  jobPromptPath?: string;
  jobRawLogPath?: string;
  jobEventwirePath?: string;
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

/**
 * What the app's autostart registration did. Mirrors the Rust `AutostartOutcome`, which is tagged:
 * `kind` names the case and `detail` carries the unit path or the reason.
 */
export interface AutostartOutcome {
  kind: "registered" | "alreadyRegistered" | "skipped" | "failed";
  detail: string;
}

/**
 * The result of installing the bundled daemon into `<tendril home>/bin` and registering it to start
 * with the session. The app does this on first run; the Service pane can retry it.
 */
export interface ProvisionReport {
  /** Sidecars copied this run. */
  installed: string[];
  /** Sidecars that were already current. */
  upToDate: string[];
  /** Sidecars this build does not carry - ordinary in a dev build, a packaging bug in a bundle. */
  missing: string[];
  binDir: string;
  autostart: AutostartOutcome;
  /** Non-fatal failures: a run can install one binary, fail the other and still register autostart. */
  errors: string[];
}

export interface ReviewActionConfig {
  name: string;
  condition: string;
  command: string;
  paths?: string[];
}

/**
 * Whether one review action's condition holds for a plan, as the daemon decided it
 * (`GET /api/projects/:name/review-actions?planId=...`).
 *
 * The daemon evaluates it against the plan folder, as V1's `ContentView` did with
 * `PlatformHelper.EvaluatePowerShellCondition(action.Condition, folderPath)` — a `Test-Path` needs a
 * filesystem and a POSIX condition needs a shell, and the webview has neither.
 */
export interface ReviewActionConditionResult {
  name: string;
  /** The condition as configured. */
  condition: string;
  /**
   * `met`: holds, or there is no condition. `notMet`: evaluated and does not hold, which is what V1
   * disabled the button on. `unknown`: could not be evaluated at all (unsupported syntax, a timeout).
   * Typed as `string` too, because an older or newer daemon's value must not be read as one of these.
   */
  state: "met" | "notMet" | "unknown" | (string & {});
  /** Why the condition could not be evaluated. Present only for `unknown`. */
  reason?: string | null;
}

export interface ProjectSummary {
  name: string;
  /**
   * The project's configured colour as an Ivy `Colors` name (`Blue`, `Amber`, ...), resolved to a CSS
   * variable with `ivyColorVar`. Absent when `config.yaml` leaves it blank — the bridge drops the
   * empty string — which is what a sidebar marker reads as "fall back to the neutral colour".
   */
  color?: string;
  repos: string[];
  verifications: string[];
  reviewActions?: ReviewActionConfig[];
}

/**
 * A **read-only projection** of the wire shape, deliberately narrower than it. The server returns the
 * whole `ProjectConfig`, including the unmodeled keys it round-trips (the agent security block —
 * `sandboxMode`, `securityPreset`, `filePermissions`, … — written by the .NET V1 app). Nothing in the
 * app writes a project today, so dropping them here loses nothing.
 *
 * A future project-settings screen MUST PATCH only the fields it changed rather than PUT an object
 * reconstructed from this type, or it will clear every key absent from it.
 */
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
  /** Absent means "on": the setting is only written to `config.yaml` once the operator toggles it. */
  desktopNotifications?: boolean;
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

/** Mirrors `tendril_core::newsletter::SubscribeOutcome`. */
export interface SubscribeOutcome {
  subscribed: boolean;
  error: string | null;
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
  /**
   * Local paths, or remote URLs for the daemon to clone. A URL is never stored: the route clones it
   * into `<TendrilHome>/Projects/<name>/Repos/<owner>/<repo>` and keeps that path, which is why the
   * caller has to read {@link CreatedProject.repos} back rather than reuse what it sent.
   */
  repos?: string[];
}

/**
 * What `POST /api/projects` answers with: the project as it was written, whose `repos` are the
 * resolved paths. Narrowed to the fields the create callers read.
 */
export interface CreatedProject {
  name: string;
  repos?: { path: string; baseBranch?: string }[];
}

/**
 * What `POST /api/projects/:name/repos` answers with: the repository as it was stored. For a remote
 * that is the clone's directory rather than the URL that was sent - the route clones before it
 * writes, and the response is the only place the caller can learn where to.
 */
export interface AddedProjectRepo {
  path: string;
  baseBranch?: string;
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
  /**
   * Title and body to use instead of the plan's. Set when the issue is about something other than
   * the plan itself — today, a recommendation being filed for later. The job stays plan-scoped
   * either way: the plan is what resolves the working directory and the Jobs view's plan column.
   */
  titleOverride?: string;
  bodyOverride?: string;
  /**
   * What the subject came from, for the issue footer and the job's dedupe key. `planId::title` for
   * a recommendation, matching `recommendationId()`.
   */
  issueSource?: string;
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

/**
 * One draft annotation on a plan's revision markdown, mirroring `AnnotationDto` in
 * `src-tauri/src/models.rs`.
 *
 * `startOffset`/`endOffset` are character offsets into the revision text and `selectedText` is what
 * they covered when the annotation was made, so a stale annotation can be recognised as stale
 * rather than silently re-anchored. Unlike a `DraftComment` these are keyed on `id` alone.
 */
export interface Annotation {
  id: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  comment: string;
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

export interface CrossPlanRecommendation extends RecommendationItem {
  planId: string;
  planTitle?: string;
  planFolderName?: string;
  project: string;
  sourcePlanStatus?: string;
  date?: string;
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

// --- dashboard analytics ---
//
// `null` is meaningful throughout: it means "unknown", never "zero". An unpriced
// plan has a null cost because its rows carried tokens without a charge, and a
// null projection means there was no spend to project from. Rendering either as
// $0.00 asserts something the data does not say.

export interface DashboardMonthStats {
  year: number;
  month: number;
  plansCreated: number;
  prsMerged: number;
  cost: number;
  tokens: number;
}

export interface DashboardDailyCost {
  date: string;
  cost: number;
  tokens: number;
  apiCost: number;
  apiTokens: number;
  subsidizedCost: number;
  subsidizedTokens: number;
}

export interface DashboardDailyPlans {
  date: string;
  count: number;
}

export interface CostForecast {
  /** Spend per calendar day times the month's length: the lower bound. */
  calendarProjection: number | null;
  calendarDays: number;
  /** Spend per day that had spend: the upper bound, never below the calendar one. */
  activityProjection: number | null;
  activityDays: number;
  totalSpend: number;
  daysInMonth: number;
  apiCalendarProjection: number | null;
  apiActivityProjection: number | null;
  totalApiSpend: number;
  totalSubsidizedSpend: number;
  totalApiTokens: number;
  totalSubsidizedTokens: number;
  subsidizedTokenPercent: number;
  subsidizedCostPercent: number;
}

export interface DashboardActivity {
  months: DashboardMonthStats[];
  prevWeekAvgCost: number;
  dailyCosts: DashboardDailyCost[];
  dailyPlans: DashboardDailyPlans[];
  /** Earliest day on record, clamped to the window. `null` gates the rolling average off. */
  dailyDataStart: string | null;
  forecast: CostForecast;
}

export interface ShippedFeatureDay {
  date: string;
  count: number;
}

export interface RecentMergedPr {
  prUrl: string;
  planId: number;
  title: string;
  repo: string | null;
  updated: string;
}

export interface RecentPlanCost {
  planId: number;
  title: string;
  state: string;
  created: string;
  /** `null` when no row was priced. Renders as a dash, never $0.00. */
  cost: number | null;
  tokens: number;
}

export interface AgentCostBreakdown {
  agent: string;
  cost: number;
  tokens: number;
  planCount: number;
}
