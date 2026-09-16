import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  bridge,
  resetTendrilClient,
  setTendrilClient,
  type TendrilClient,
} from "../src/api/bridge";

// The seam that lets a client which is not on the daemon's machine exist at all. Views import `bridge`
// and must not care whether it reaches the daemon over Tauri IPC or over HTTP with a session token, so
// what is asserted here is that swapping the implementation is invisible to a caller.

afterEach(() => {
  resetTendrilClient();
});

/** A stand-in for the HTTP client a web or mobile build would install. */
function fakeClient(calls: string[]): TendrilClient {
  return new Proxy({} as TendrilClient, {
    get(_target, property) {
      return (...args: unknown[]) => {
        calls.push(`${String(property)}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return Promise.resolve(null);
      };
    },
  });
}

describe("client transport seam", () => {
  it("routes calls to the installed client", async () => {
    const calls: string[] = [];
    setTendrilClient(fakeClient(calls));

    await bridge.getServiceInfo();
    await bridge.acceptInboxProposal(7);

    expect(calls).toEqual(["getServiceInfo()", "acceptInboxProposal(7)"]);
  });

  it("keeps the same imported reference across a swap", async () => {
    // Views capture `bridge` at import time, so a swap has to be visible through the existing binding
    // rather than requiring every consumer to re-import.
    const before = bridge;
    const calls: string[] = [];
    setTendrilClient(fakeClient(calls));

    expect(bridge).toBe(before);
    await before.dismissInboxProposal(1);
    expect(calls).toEqual(["dismissInboxProposal(1)"]);
  });

  it("restores the Tauri client on reset", () => {
    setTendrilClient(fakeClient([]));
    resetTendrilClient();

    // The real client's methods are declared `this: void` and call `invoke`, which is absent outside a
    // Tauri webview - so identity is what is checked here, not a call.
    expect(typeof bridge.getServiceInfo).toBe("function");
    expect("getServiceInfo" in bridge).toBe(true);
  });

  it("exposes the client's keys, so the surface stays enumerable", () => {
    // `ownKeys`/`getOwnPropertyDescriptor` are forwarded as well as `get`, so spying and enumeration
    // behave the same as on a plain object.
    expect(Object.keys(bridge)).toContain("getServiceInfo");
    expect(Object.keys(bridge).length).toBeGreaterThan(50);
  });
});
