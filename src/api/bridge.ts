import { invoke } from "@tauri-apps/api/core";
import type {
  Job,
  JobDetail,
  PlanDetail,
  PlanQuery,
  PlanSummary,
  ProjectSummary,
  RevisionResult,
  ServiceHealth,
  ServiceInfo,
  StartJobArgs,
  StartJobResponse,
  TendrilConfig,
} from "../types/api";

export const bridge = {
  async checkServiceHealth(): Promise<ServiceHealth> {
    return invoke<ServiceHealth>("cmd_check_service_health");
  },

  async getServiceInfo(): Promise<ServiceInfo> {
    return invoke<ServiceInfo>("cmd_get_service_info");
  },

  async listPlans(query?: PlanQuery): Promise<PlanSummary[]> {
    return invoke<PlanSummary[]>("cmd_list_plans", { query });
  },

  async getPlan(id: string): Promise<PlanDetail> {
    return invoke<PlanDetail>("cmd_get_plan", { id });
  },

  async updatePlanField(
    id: string,
    field: string,
    value: string,
    allowFailed?: boolean
  ): Promise<void> {
    return invoke<void>("cmd_update_plan_field", {
      id,
      field,
      value,
      allowFailed,
    });
  },

  async getRevision(id: string, number?: number): Promise<string> {
    return invoke<string>("cmd_get_revision", { id, number });
  },

  async writeRevision(id: string, content: string): Promise<RevisionResult> {
    return invoke<RevisionResult>("cmd_write_revision", { id, content });
  },

  async listJobs(status?: string, limit?: number): Promise<Job[]> {
    return invoke<Job[]>("cmd_list_jobs", { status, limit });
  },

  async getJob(id: string): Promise<JobDetail> {
    return invoke<JobDetail>("cmd_get_job", { id });
  },

  async startJob(args: StartJobArgs): Promise<StartJobResponse> {
    return invoke<StartJobResponse>("cmd_start_job", { args });
  },

  async cancelJob(id: string, message?: string): Promise<void> {
    return invoke<void>("cmd_cancel_job", { id, message });
  },

  async listProjects(): Promise<ProjectSummary[]> {
    return invoke<ProjectSummary[]>("cmd_list_projects");
  },

  async getConfig(): Promise<TendrilConfig> {
    return invoke<TendrilConfig>("cmd_get_config");
  },

  async saveUiState(key: string, value: string): Promise<void> {
    return invoke<void>("cmd_save_ui_state", { key, value });
  },

  async loadUiState(key: string): Promise<string | null> {
    return invoke<string | null>("cmd_load_ui_state", { key });
  },
};
