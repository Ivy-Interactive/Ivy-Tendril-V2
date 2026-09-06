import type { WSServerMessage } from "./dtos";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

export type EventCallback = (msg: WSServerMessage) => void;
export type StateCallback = (state: ConnectionState) => void;

export interface RealtimeClientOptions {
  host: string;
  port: number;
  scheme?: string;
  secret?: string;
  autoConnect?: boolean;
}

export class TendrilRealtimeClient {
  private host: string;
  private port: number;
  private scheme: string;
  private secret?: string;
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private eventListeners: Set<EventCallback> = new Set();
  private stateListeners: Set<StateCallback> = new Set();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isDisposed = false;

  constructor(options: RealtimeClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.scheme = options.scheme === "https" ? "wss" : "ws";
    this.secret = options.secret;

    if (options.autoConnect) {
      this.connect();
    }
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public onMessage(callback: EventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  public onStateChange(callback: StateCallback): () => void {
    this.stateListeners.add(callback);
    callback(this.connectionState);
    return () => this.stateListeners.delete(callback);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      for (const listener of this.stateListeners) {
        listener(state);
      }
    }
  }

  public connect(): void {
    if (this.isDisposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setConnectionState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const qs = this.secret ? `?token=${encodeURIComponent(this.secret)}` : "";
    const url = `${this.scheme}://${this.host}:${this.port}/api/ws${qs}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.setConnectionState("connected");
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSServerMessage;
          for (const listener of this.eventListeners) {
            listener(data);
          }
        } catch {
          // Ignored malformed websocket frame
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.ws = null;
        if (!this.isDisposed) {
          this.setConnectionState("disconnected");
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // Triggers close event
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch {
      this.setConnectionState("disconnected");
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ action: "ping" }));
        } catch {
          // Ignore send failures, onclose handles reconnect
        }
      }
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isDisposed || this.reconnectTimer) return;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, up to 30s + jitter
    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000);
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;

    this.reconnectAttempt++;
    this.setConnectionState("reconnecting");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  public send(action: string, payload: Record<string, unknown> = {}): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, ...payload }));
      return true;
    }
    return false;
  }

  public disconnect(): void {
    this.isDisposed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState("disconnected");
  }
}
