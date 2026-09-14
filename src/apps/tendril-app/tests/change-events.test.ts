import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyChangeEvent, shouldRefreshDetailFor } from "../src/api/changes";
import type { ChangeEvent } from "../src/api/events";

const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));

function deps() {
  return {
    refreshPlans: vi.fn(),
    refreshPlanDetail: vi.fn(),
    refreshJobs: vi.fn(),
    refreshProjects: vi.fn(),
    selectedPlanFolder: "/tendril/Plans/00576-PortFilesystemWatcher",
  };
}

function plansEvent(folder: string | null): ChangeEvent {
  return { type: "fs.change", target: { kind: "plans", folder } };
}

describe("applyChangeEvent", () => {
  it("refreshes the detail view only when the change names the open plan", () => {
    const matching = deps();
    applyChangeEvent(plansEvent("00576-PortFilesystemWatcher"), matching);
    expect(matching.refreshPlans).toHaveBeenCalledTimes(1);
    expect(matching.refreshJobs).toHaveBeenCalledTimes(1);
    expect(matching.refreshPlanDetail).toHaveBeenCalledTimes(1);

    // Rebuilding a single-plan view is expensive, so an unrelated plan must not trigger it — the
    // list and the job counts still refresh, because both include the changed plan.
    const other = deps();
    applyChangeEvent(plansEvent("00999-SomethingElse"), other);
    expect(other.refreshPlans).toHaveBeenCalledTimes(1);
    expect(other.refreshJobs).toHaveBeenCalledTimes(1);
    expect(other.refreshPlanDetail).not.toHaveBeenCalled();

    // A full rescan cannot say which plan changed, so the open one is assumed to be affected.
    const rescan = deps();
    applyChangeEvent(plansEvent(null), rescan);
    expect(rescan.refreshPlans).toHaveBeenCalledTimes(1);
    expect(rescan.refreshJobs).toHaveBeenCalledTimes(1);
    expect(rescan.refreshPlanDetail).toHaveBeenCalledTimes(1);
  });

  it("leaves the detail view alone when no plan is open", () => {
    const d = { ...deps(), selectedPlanFolder: null };
    applyChangeEvent(plansEvent(null), d);
    expect(d.refreshPlans).toHaveBeenCalledTimes(1);
    expect(d.refreshPlanDetail).not.toHaveBeenCalled();
  });

  it("maps config to projects and inbox to nothing", () => {
    const config = deps();
    applyChangeEvent({ type: "fs.change", target: { kind: "config" } }, config);
    expect(config.refreshProjects).toHaveBeenCalledTimes(1);
    expect(config.refreshPlans).not.toHaveBeenCalled();
    expect(config.refreshJobs).not.toHaveBeenCalled();
    expect(config.refreshPlanDetail).not.toHaveBeenCalled();

    // The event is carried end-to-end, but V2 has no file-based inbox ingestion to invalidate yet.
    const inbox = deps();
    applyChangeEvent({ type: "fs.change", target: { kind: "inbox" } }, inbox);
    expect(inbox.refreshPlans).not.toHaveBeenCalled();
    expect(inbox.refreshJobs).not.toHaveBeenCalled();
    expect(inbox.refreshProjects).not.toHaveBeenCalled();
    expect(inbox.refreshPlanDetail).not.toHaveBeenCalled();
  });
});

describe("shouldRefreshDetailFor", () => {
  it("compares last path segments case-insensitively", () => {
    // One side is a folder path from the detail view, the other a bare folder name from the event.
    expect(shouldRefreshDetailFor("00576-Foo", "/tendril/Plans/00576-Foo")).toBe(true);
    expect(shouldRefreshDetailFor("00576-Foo", "C:\\tendril\\Plans\\00576-Foo")).toBe(true);
    expect(shouldRefreshDetailFor("00576-foo", "/tendril/Plans/00576-FOO")).toBe(true);
    expect(shouldRefreshDetailFor("00576-Foo", "/tendril/Plans/00576-Foo/")).toBe(true);
    expect(shouldRefreshDetailFor("00577-Bar", "/tendril/Plans/00576-Foo")).toBe(false);
  });

  it("treats a full rescan and an absent selection as a match", () => {
    expect(shouldRefreshDetailFor(null, "/tendril/Plans/00576-Foo")).toBe(true);
    expect(shouldRefreshDetailFor("00576-Foo", null)).toBe(true);
    expect(shouldRefreshDetailFor("00576-Foo", undefined)).toBe(true);
  });
});

describe("onChangeEvent", () => {
  beforeEach(() => {
    listen.mockReset();
  });

  it("subscribes to the change-event channel and forwards the payload", async () => {
    const unlisten = vi.fn();
    let capturedChannel = "";
    let capturedHandler: ((e: { payload: ChangeEvent }) => void) | undefined;

    listen.mockImplementation((channel: string, handler: (e: { payload: ChangeEvent }) => void) => {
      capturedChannel = channel;
      capturedHandler = handler;
      return Promise.resolve(unlisten);
    });

    const { onChangeEvent } = await import("../src/api/events");
    const received: ChangeEvent[] = [];
    const unsubscribe = await onChangeEvent((e) => received.push(e));

    expect(capturedChannel).toBe("change-event");

    const event = plansEvent("00576-PortFilesystemWatcher");
    capturedHandler?.({ payload: event });
    expect(received).toEqual([event]);

    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("forwards change-stream-status transitions", async () => {
    const unlisten = vi.fn();
    let capturedChannel = "";
    let capturedHandler: ((e: { payload: string }) => void) | undefined;

    listen.mockImplementation((channel: string, handler: (e: { payload: string }) => void) => {
      capturedChannel = channel;
      capturedHandler = handler;
      return Promise.resolve(unlisten);
    });

    const { onChangeStreamStatus } = await import("../src/api/events");
    const seen: string[] = [];
    const unsubscribe = await onChangeStreamStatus((s) => seen.push(s));

    expect(capturedChannel).toBe("change-stream-status");
    capturedHandler?.({ payload: "connected" });
    capturedHandler?.({ payload: "disconnected" });
    expect(seen).toEqual(["connected", "disconnected"]);

    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
