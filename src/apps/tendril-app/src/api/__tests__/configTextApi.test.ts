import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  configTextApi,
  resetConfigTextTransports,
  setConfigTextTransports,
} from "../configTextApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

/** Puts the shell around us, so the module takes its Tauri branch. The same trick `table-query.test.ts` uses. */
function enterShell(): void {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

function leaveShell(): void {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

/** A `fetch` answering one response. Returns the calls, because the URL and method are what most of these assert. */
function stubFetch(response: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}): { url: string; init?: RequestInit }[] {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: response.json ?? (() => Promise.resolve({})),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  leaveShell();
});

afterEach(() => {
  resetConfigTextTransports();
  leaveShell();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("configTextApi.read", () => {
  it("goes through the command inside the shell, never a fetch", async () => {
    enterShell();
    const calls = stubFetch({});
    invokeMock.mockResolvedValue({ text: "codingAgent: claude\n", maskedPaths: ["llm.apiKey"] });

    const masked = await configTextApi.read();

    expect(invokeMock).toHaveBeenCalledWith("cmd_get_config_text");
    expect(calls).toEqual([]);
    expect(masked).toEqual({ text: "codingAgent: claude\n", maskedPaths: ["llm.apiKey"] });
  });

  it("falls to the dev server's proxied route outside the shell", async () => {
    const calls = stubFetch({
      json: () => Promise.resolve({ text: "a: 1\n", maskedPaths: [] }),
    });

    const masked = await configTextApi.read();

    expect(calls[0]?.url).toBe("/api/config/text");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(masked).toEqual({ text: "a: 1\n", maskedPaths: [] });
  });

  it("surfaces the daemon's own error string, which is the masking failure's reason", async () => {
    stubFetch({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "config.yaml has a block scalar under a secret key" }),
    });

    await expect(configTextApi.read()).rejects.toThrow(
      "config.yaml has a block scalar under a secret key",
    );
  });
});

describe("configTextApi.write", () => {
  it("goes through the command inside the shell, passing the text as the named argument", async () => {
    enterShell();
    const calls = stubFetch({});
    invokeMock.mockResolvedValue({ status: "ok" });

    await configTextApi.write('llm:\n  apiKey: "********"\n');

    expect(invokeMock).toHaveBeenCalledWith("cmd_put_config_text", {
      text: 'llm:\n  apiKey: "********"\n',
    });
    expect(calls).toEqual([]);
  });

  it("PUTs the text as JSON outside the shell", async () => {
    const calls = stubFetch({ json: () => Promise.resolve({ status: "ok" }) });

    await configTextApi.write("a: 1\n");

    expect(calls[0]?.url).toBe("/api/config/text");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse((calls[0]?.init?.body ?? "") as string)).toEqual({ text: "a: 1\n" });
  });

  it("surfaces the daemon's validation message, which is already masked by construction", async () => {
    stubFetch({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid type: string "nope" for jobTimeout' }),
    });

    await expect(configTextApi.write("jobTimeout: nope\n")).rejects.toThrow(
      'invalid type: string "nope" for jobTimeout',
    );
  });

  /**
   * The one property worth pinning on its own: the fallback message is built from the path and the
   * status, never from the body the caller submitted. Mid-edit that body can hold a credential the
   * operator has typed and not yet saved, and an error line is the easiest place in the app for one
   * to end up on screen or in a bug report.
   */
  it("never echoes the submitted text when the daemon answers without an error field", async () => {
    stubFetch({ ok: false, status: 502, json: () => Promise.reject(new Error("not json")) });
    const secret = "sk-ant-notarealkey-0000";

    await expect(configTextApi.write(`llm:\n  apiKey: ${secret}\n`)).rejects.toThrow(
      "Request to /api/config/text failed (502)",
    );
    await expect(configTextApi.write(`llm:\n  apiKey: ${secret}\n`)).rejects.not.toThrow(secret);
  });
});

describe("the transport seam", () => {
  it("swaps read and write, and restores both on reset", async () => {
    const calls = stubFetch({ json: () => Promise.resolve({ text: "real\n", maskedPaths: [] }) });
    const written: string[] = [];
    setConfigTextTransports({
      read: () => Promise.resolve({ text: "fake\n", maskedPaths: ["llm.apiKey"] }),
      write: (text) => {
        written.push(text);
        return Promise.resolve();
      },
    });

    expect(await configTextApi.read()).toEqual({ text: "fake\n", maskedPaths: ["llm.apiKey"] });
    await configTextApi.write("edited\n");
    expect(written).toEqual(["edited\n"]);
    expect(calls).toEqual([]);

    resetConfigTextTransports();
    expect(await configTextApi.read()).toEqual({ text: "real\n", maskedPaths: [] });
  });

  it("leaves an already-installed half alone when the other is set on its own", async () => {
    const calls = stubFetch({ json: () => Promise.resolve({ text: "real\n", maskedPaths: [] }) });
    setConfigTextTransports({ read: () => Promise.resolve({ text: "fake\n", maskedPaths: [] }) });
    setConfigTextTransports({ write: () => Promise.resolve() });

    // A second call naming only `write` must not quietly put `read` back on the HTTP path — a view
    // that installs the two halves from different effects would otherwise start hitting the daemon.
    expect(await configTextApi.read()).toEqual({ text: "fake\n", maskedPaths: [] });
    expect(calls).toEqual([]);
  });
});
