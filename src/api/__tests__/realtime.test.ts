import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TendrilRealtimeClient } from "../realtime";

describe("TendrilRealtimeClient", () => {
  let mockWebSocketInstances: any[] = [];

  class MockWebSocket {
    public url: string;
    public readyState: number = 0; // CONNECTING
    public onopen: (() => void) | null = null;
    public onclose: (() => void) | null = null;
    public onmessage: ((event: { data: string }) => void) | null = null;
    public onerror: (() => void) | null = null;
    public sentData: string[] = [];

    constructor(url: string) {
      this.url = url;
      mockWebSocketInstances.push(this);
    }

    public send(data: string) {
      this.sentData.push(data);
    }

    public close() {
      this.readyState = 3; // CLOSED
      if (this.onclose) this.onclose();
    }

    public triggerOpen() {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }

    public triggerMessage(data: unknown) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
    }
  }

  beforeEach(() => {
    mockWebSocketInstances = [];
    (global as any).WebSocket = MockWebSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects and dispatches incoming messages to subscribers", () => {
    const client = new TendrilRealtimeClient({
      host: "127.0.0.1",
      port: 5010,
      secret: "token123",
      autoConnect: true,
    });

    const received: any[] = [];
    client.onMessage((msg) => received.push(msg));

    const ws = mockWebSocketInstances[0];
    expect(ws.url).toBe("ws://127.0.0.1:5010/api/ws?token=token123");

    ws.triggerOpen();
    expect(client.getConnectionState()).toBe("connected");

    ws.triggerMessage({ type: "status", message: "Plan building..." });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: "status", message: "Plan building..." });

    client.disconnect();
    expect(client.getConnectionState()).toBe("disconnected");
  });

  it("handles reconnection with exponential backoff on disconnect", () => {
    const client = new TendrilRealtimeClient({
      host: "127.0.0.1",
      port: 5010,
      autoConnect: true,
    });

    const states: string[] = [];
    client.onStateChange((s) => states.push(s));

    const ws1 = mockWebSocketInstances[0];
    ws1.triggerOpen();
    expect(client.getConnectionState()).toBe("connected");

    // Simulate unexpected drop
    ws1.close();
    expect(client.getConnectionState()).toBe("reconnecting");

    // Advance timer past first backoff (~1000ms + jitter)
    vi.advanceTimersByTime(2000);
    expect(mockWebSocketInstances.length).toBe(2);

    client.disconnect();
  });
});
