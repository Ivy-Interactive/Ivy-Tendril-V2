export type DaemonConnectionState =
  | "Connected"
  | "Disconnected"
  | "Unauthenticated"
  | "NotRunning";

export interface MasterInfo {
  port: number;
  pid: number;
  secret: string;
  startedAt: string;
  host: string;
  scheme: string;
  version: string;
  apiVersion: number;
  capabilities: string[];
}

export interface DaemonStatusResponse {
  state: DaemonConnectionState;
  tendrilHome: string;
  port?: number;
  host?: string;
  scheme?: string;
  secret?: string;
  pid?: number;
  apiVersion?: number;
  capabilities: string[];
  message: string;
}

export interface HealthResponse {
  status: string;
  pid?: number;
  version?: string;
  apiVersion?: number;
  capabilities?: string[];
}

export interface PlanVerificationDto {
  name: string;
  status: "Pending" | "Pass" | "Fail" | "Skipped";
}

export interface PlanDto {
  id: string;
  title: string;
  state:
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
  project: string;
  level: string;
  priority?: number;
  executionProfile?: string;
  created?: string;
  updated?: string;
  repos?: string[];
  verifications?: PlanVerificationDto[];
  dependsOn?: string[];
  relatedPlans?: string[];
  commits?: string[];
  prs?: string[];
}

export interface JobDto {
  id: string;
  planId?: string;
  planTitle?: string;
  promptware: string;
  status: "Pending" | "Queued" | "Running" | "Completed" | "Failed" | "Timeout" | "Stopped";
  statusMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  cost?: number;
  tokens?: number;
}

export interface ProjectDto {
  name: string;
  color?: string;
  stackHash?: string;
  repos: Array<{ path: string; baseBranch?: string }>;
  verifications?: Array<{ name: string; required?: boolean }>;
}

export interface WSServerMessage {
  type: "state" | "complete" | "status" | "log";
  step?: unknown;
  message?: string;
}

export interface WSClientMessage {
  action: "start" | "approve_plan" | "ping";
  scenario_id?: string;
  plan_id?: string;
}
