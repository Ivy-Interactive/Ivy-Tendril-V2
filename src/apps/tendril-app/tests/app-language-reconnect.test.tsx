import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, cleanup } from "@testing-library/react";
import { App } from "../src/App";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import * as events from "../src/api/events";
import { i18n } from "../src/i18n";

/**
 * The shell reads `config.yaml`'s `language` at mount, and again whenever the daemon (re)connects.
 * The mount-time read fails when the daemon starts after the webview, and a `tendril config set
 * language …` made while it was out of reach raised no change event this session heard - either way,
 * without the second read the UI would stay in the wrong language until some later config change.
 */
describe("App language on (re)connection", () => {
  type Status = "connected" | "reconnecting" | "disconnected";
  /** The status handler the shell registers, captured so a status can be delivered to it directly. */
  let deliver: ((status: Status) => void) | undefined;

  beforeEach(() => {
    vi.spyOn(bridge, "listPlans").mockResolvedValue([]);
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    vi.spyOn(events, "onServiceStatus").mockImplementation((handler) => {
      deliver = handler;
      return Promise.resolve(() => {});
    });
  });

  afterEach(async () => {
    // Unmount before restoring the spies: `App` is a real mount, and the stores it subscribes to are
    // module singletons shared with the rest of this worker.
    cleanup();
    deliver = undefined;
    vi.restoreAllMocks();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    localStorage.clear();
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("dir");
  });

  it("applies the language once the daemon connects, when the start-up read failed", async () => {
    const getConfig = vi.spyOn(bridge, "getConfig").mockRejectedValue(new Error("not running"));
    render(<App />);
    await waitFor(() => expect(deliver).toBeDefined());
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    expect(i18n.language).toBe("en");

    getConfig.mockResolvedValue({ raw: { language: "de" } });
    await act(async () => {
      deliver!("connected");
    });

    await waitFor(() => expect(i18n.language).toBe("de"));
    expect(document.documentElement.lang).toBe("de");
  });

  it("leaves the language alone when the connection drops", async () => {
    const getConfig = vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: {} });
    render(<App />);
    await waitFor(() => expect(deliver).toBeDefined());
    // From here on the file names a language, so only a re-read could switch to it.
    getConfig.mockResolvedValue({ raw: { language: "sv" } });

    await act(async () => {
      deliver!("reconnecting");
      deliver!("disconnected");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(i18n.language).toBe("en");
  });
});
