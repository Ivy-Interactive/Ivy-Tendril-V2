import { describe, it, expect, vi, beforeEach } from "vitest";
import { TendrilApiClient } from "../client";

describe("TendrilApiClient", () => {
  const mockBaseUrl = "http://127.0.0.1:5010";
  const mockSecret = "secret-token-abc-123";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches Bearer authorization header from .master secret", async () => {
    const client = new TendrilApiClient({
      baseUrl: mockBaseUrl,
      secret: mockSecret,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => [{ id: "00022", title: "Bootstrap Desktop App" }],
    });
    global.fetch = mockFetch;

    const plans = await client.listPlans();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:5010/api/plans");
    expect(options.headers).toHaveProperty("Authorization", `Bearer ${mockSecret}`);
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe("00022");
  });

  it("handles ping without secret", async () => {
    const client = new TendrilApiClient({
      baseUrl: mockBaseUrl,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "pong",
    });
    global.fetch = mockFetch;

    const pong = await client.ping();
    expect(pong).toBe("pong");
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  it("negotiates capabilities correctly with server health", async () => {
    const client = new TendrilApiClient({
      baseUrl: mockBaseUrl,
      secret: mockSecret,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        status: "ok",
        apiVersion: 2,
        capabilities: ["plans", "jobs", "realtime", "review"],
      }),
    });

    const cap = await client.negotiateCapabilities();
    expect(cap.supported).toBe(true);
    expect(cap.apiVersion).toBe(2);
    expect(cap.capabilities).toContain("realtime");
  });
});
