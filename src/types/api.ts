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
}

export type JobStatus =
  | "Pending"
  | "Queued"
  | "Running"
  | "Completed"
  | "Failed"
  | "Timeout"
  | "Stopped";

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
  state: "Connected" | "Disconnected" | "Unauthenticated" | "NotRunning";
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

export interface RecommendationItem {
  title: string;
  description: string;
  impact?: "Small" | "Medium" | "High";
  state?: "Pending" | "Accepted" | "Declined";
  declineReason?: string;
}

export interface PlanQuery {
  status?: string;
  project?: string;
  q?: string;
}
