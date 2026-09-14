import { bridge } from "../api/bridge";
import type { ServiceHealth, ServiceInfo } from "../types/api";

export type ConnectionStatus = "online" | "reconnecting" | "offline";

export interface ServiceState {
  status: ConnectionStatus;
  info: ServiceInfo | null;
  health: ServiceHealth | null;
  reconnectCountdown: number;
  latencyMs: number | null;
}

class ServiceStore {
  private state: ServiceState = {
    status: "offline",
    info: null,
    health: null,
    reconnectCountdown: 0,
    latencyMs: null,
  };

  private listeners: Set<() => void> = new Set();
  private reconnectIntervalId: number | null = null;

  public getState(): ServiceState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  public setStatus(status: ConnectionStatus): void {
    this.state.status = status;
    if (status === "reconnecting") {
      this.startCountdown(5);
    } else {
      this.clearCountdown();
    }
    this.notify();
  }

  public async checkHealth(): Promise<boolean> {
    const start = Date.now();
    try {
      const health = await bridge.checkServiceHealth();
      this.state.health = health;
      this.state.latencyMs = Date.now() - start;
      if (health.isHealthy) {
        this.setStatus("online");
        return true;
      } else {
        this.setStatus("offline");
        return false;
      }
    } catch {
      this.state.latencyMs = null;
      this.setStatus("offline");
      return false;
    }
  }

  public async refreshInfo(): Promise<ServiceInfo> {
    try {
      const info = await bridge.getServiceInfo();
      this.state.info = info;
      if (info.state === "Connected") {
        this.setStatus("online");
      } else {
        this.setStatus("offline");
      }
      this.notify();
      return info;
    } catch (err) {
      this.setStatus("offline");
      throw err;
    }
  }

  private startCountdown(seconds: number): void {
    this.clearCountdown();
    this.state.reconnectCountdown = seconds;
    this.notify();

    this.reconnectIntervalId = window.setInterval(() => {
      if (this.state.reconnectCountdown > 1) {
        this.state.reconnectCountdown -= 1;
        this.notify();
      } else {
        this.clearCountdown();
        this.checkHealth().catch(() => {});
      }
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.reconnectIntervalId !== null) {
      clearInterval(this.reconnectIntervalId);
      this.reconnectIntervalId = null;
    }
    this.state.reconnectCountdown = 0;
  }
}

export const serviceStore = new ServiceStore();
