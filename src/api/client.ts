import type {
  HealthResponse,
  JobDto,
  PlanDto,
  ProjectDto,
} from "./dtos";

export interface ApiClientConfig {
  baseUrl: string;
  secret?: string;
}

export class TendrilApiClient {
  private baseUrl: string;
  private secret?: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.secret = config.secret;
  }

  public updateConfig(config: Partial<ApiClientConfig>): void {
    if (config.baseUrl !== undefined) {
      this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    }
    if (config.secret !== undefined) {
      this.secret = config.secret;
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getSecret(): string | undefined {
    return this.secret;
  }

  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };
    if (this.secret) {
      headers["Authorization"] = `Bearer ${this.secret}`;
    }
    return headers;
  }

  public async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const mergedHeaders = {
      ...this.getHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    };

    const response = await fetch(url, {
      ...options,
      headers: mergedHeaders,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`API Error ${response.status}: ${errorText || response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  public async ping(): Promise<string> {
    return this.request<string>("/api/ping");
  }

  public async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/health");
  }

  public async listPlans(query?: { status?: string; project?: string; q?: string }): Promise<PlanDto[]> {
    const params = new URLSearchParams();
    if (query?.status) params.set("status", query.status);
    if (query?.project) params.set("project", query.project);
    if (query?.q) params.set("q", query.q);

    const qs = params.toString();
    return this.request<PlanDto[]>(`/api/plans${qs ? `?${qs}` : ""}`);
  }

  public async getPlan(planId: string): Promise<PlanDto> {
    return this.request<PlanDto>(`/api/plans/${encodeURIComponent(planId)}`);
  }

  public async listJobs(status?: string): Promise<JobDto[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request<JobDto[]>(`/api/jobs${qs}`);
  }

  public async getJob(jobId: string): Promise<JobDto> {
    return this.request<JobDto>(`/api/jobs/${encodeURIComponent(jobId)}`);
  }

  public async listProjects(): Promise<ProjectDto[]> {
    return this.request<ProjectDto[]>("/api/projects");
  }

  public async getConfig(key?: string): Promise<Record<string, unknown>> {
    const qs = key ? `?key=${encodeURIComponent(key)}` : "";
    return this.request<Record<string, unknown>>(`/api/config${qs}`);
  }

  public async negotiateCapabilities(): Promise<{ supported: boolean; apiVersion: number; capabilities: string[] }> {
    try {
      const health = await this.getHealth();
      const apiVersion = health.apiVersion ?? 1;
      const capabilities = health.capabilities ?? [];
      const supported = apiVersion >= 1;
      return { supported, apiVersion, capabilities };
    } catch {
      // If health endpoint fails or returns fallback ping
      const pong = await this.ping().catch(() => "");
      return {
        supported: pong.includes("pong"),
        apiVersion: 1,
        capabilities: [],
      };
    }
  }
}
