import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  ShareTunnelDialog,
  shareUrlForPlan,
  type ShareTunnelApi,
  type ShareTunnelSnapshot,
} from "../ShareTunnelDialog";
import { notificationsStore } from "../../../state/notificationsStore";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
// The dialog resolves its commands through `invoke`; every test injects a stub `api` instead, so this
// mock only exists to keep the import from reaching a real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { openUrl } from "@tauri-apps/plugin-opener";

const DISABLED: ShareTunnelSnapshot = { status: "disabled", installed: true, sharePort: 5011 };
const CONNECTING: ShareTunnelSnapshot = {
  status: "connecting",
  shareToken: "tok-abc",
  installed: true,
  sharePort: 5011,
};
const CONNECTED: ShareTunnelSnapshot = {
  status: "connected",
  url: "https://calm-otter.trycloudflare.com",
  shareToken: "tok-abc",
  installed: true,
  startedAt: "2026-09-16T10:00:00Z",
  sharePort: 5011,
};

function stubApi(overrides: Partial<ShareTunnelApi> = {}): ShareTunnelApi {
  return {
    getStatus: vi.fn().mockResolvedValue(DISABLED),
    start: vi.fn().mockResolvedValue(CONNECTING),
    stop: vi.fn().mockResolvedValue(DISABLED),
    ...overrides,
  };
}

async function renderDialog(api: ShareTunnelApi, props: Record<string, unknown> = {}) {
  await act(async () => {
    render(<ShareTunnelDialog isOpen onClose={vi.fn()} api={api} {...props} />);
  });
}

/** V1's `client.Toast(...)`. Held as a local so an assertion never references it through the store. */
let notifySuccess: MockInstance<typeof notificationsStore.notifySuccess>;

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  notifySuccess = vi.spyOn(notificationsStore, "notifySuccess").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ShareTunnelDialog", () => {
  it("reads the current status on open and starts nothing by itself", async () => {
    const api = stubApi();
    await renderDialog(api);

    expect(screen.getByTestId("share-tunnel-dialog")).toBeInTheDocument();
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(api.start).not.toHaveBeenCalled();
    // V1's opening paragraph is the promise the whole feature makes.
    expect(screen.getByText(/read-only Cloudflare tunnel/)).toBeInTheDocument();
  });

  it("offers only Start while disabled", async () => {
    await renderDialog(stubApi());

    expect(screen.getByTestId("share-start")).toBeInTheDocument();
    expect(screen.queryByTestId("share-stop")).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-tunnel-url")).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-tunnel-connecting")).not.toBeInTheDocument();
  });

  it("shows the starting callout while the tunnel comes up, and no URL yet", async () => {
    const api = stubApi();
    await renderDialog(api);

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-start"));
    });

    expect(api.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("share-tunnel-connecting")).toHaveTextContent(
      /typically takes 15-30 seconds/,
    );
    expect(
      screen.queryByTestId("share-tunnel-url"),
      "a connecting tunnel must not hand out a link",
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-start")).not.toBeInTheDocument();
  });

  it("polls while connecting and swaps to the live link once connected", async () => {
    vi.useFakeTimers();
    const getStatus = vi.fn().mockResolvedValueOnce(CONNECTING).mockResolvedValue(CONNECTED);
    const api = stubApi({ getStatus });

    render(<ShareTunnelDialog isOpen onClose={vi.fn()} api={api} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("share-tunnel-connecting")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("share-tunnel-url")).toHaveTextContent(
      "https://calm-otter.trycloudflare.com",
    );
    expect(screen.queryByTestId("share-tunnel-connecting")).not.toBeInTheDocument();

    // And the poll stops once it has settled: no third read.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("stops polling when the dialog closes", async () => {
    vi.useFakeTimers();
    const getStatus = vi.fn().mockResolvedValue(CONNECTING);
    const api = stubApi({ getStatus });

    const { unmount } = render(<ShareTunnelDialog isOpen onClose={vi.fn()} api={api} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getStatus).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("copies the link and opens it in a browser once connected", async () => {
    const api = stubApi({ getStatus: vi.fn().mockResolvedValue(CONNECTED) });
    await renderDialog(api);

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-copy"));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://calm-otter.trycloudflare.com",
    );

    fireEvent.click(screen.getByTestId("share-open"));
    expect(openUrl).toHaveBeenCalledWith("https://calm-otter.trycloudflare.com");
  });

  it("shows the copy error and fires no success toast when neither clipboard mechanism works", async () => {
    const api = stubApi({ getStatus: vi.fn().mockResolvedValue(CONNECTED) });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("clipboard blocked")) },
    });
    // jsdom does not implement `execCommand`, but that is an environment gap, not a guarantee this
    // test should lean on — make the "no working fallback" case explicit rather than relying on it.
    document.execCommand = vi.fn(() => false);
    await renderDialog(api);

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-copy"));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://calm-otter.trycloudflare.com",
    );
    await waitFor(() =>
      expect(screen.getByTestId("share-tunnel-error")).toHaveTextContent(/Could not copy the link/),
    );
    expect(notifySuccess).not.toHaveBeenCalledWith("Link Copied", expect.anything());
  });

  /** V1's `ShareTunnelModal(planFolderName, isReview)`: the link deep-links to the plan. */
  it("deep-links to a plan when one is given, carrying the share token", async () => {
    const api = stubApi({ getStatus: vi.fn().mockResolvedValue(CONNECTED) });
    await renderDialog(api, { planId: "00021-Ship-It" });

    expect(screen.getByTestId("share-tunnel-url")).toHaveTextContent(
      "https://calm-otter.trycloudflare.com/review?planId=00021-Ship-It&share=1&shareToken=tok-abc",
    );
  });

  it("stops sharing and returns to the Start state", async () => {
    const stop = vi.fn().mockResolvedValue(DISABLED);
    const api = stubApi({ getStatus: vi.fn().mockResolvedValue(CONNECTED), stop });
    await renderDialog(api);

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-stop"));
    });

    expect(stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("share-start")).toBeInTheDocument());
    expect(screen.queryByTestId("share-tunnel-url")).not.toBeInTheDocument();
  });

  /**
   * The failure that matters most on a fresh machine: `cloudflared` is not installed. The daemon's
   * message is the install instruction, so it has to reach the operator unaltered and unprefixed.
   */
  it("shows the daemon's install instructions verbatim when cloudflared is missing", async () => {
    const start = vi.fn().mockRejectedValue({
      code: "TUNNEL_PRECONDITION",
      message:
        "cloudflared is not installed. Tendril looked for it at /tmp/tools/cloudflared and on PATH. Install it with your package manager (macOS: `brew install cloudflared`).",
    });
    const api = stubApi({ start });
    await renderDialog(api);

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-start"));
    });

    const alert = screen.getByTestId("share-tunnel-error");
    expect(alert).toHaveTextContent("cloudflared is not installed");
    expect(alert).toHaveTextContent("brew install cloudflared");
    expect(alert).not.toHaveTextContent("Failed to start share tunnel");
    // A refused start must not leave a spinner up.
    expect(screen.queryByTestId("share-tunnel-connecting")).not.toBeInTheDocument();
    expect(screen.getByTestId("share-start")).toBeInTheDocument();
  });

  it("reports any other start failure and returns to the Start state", async () => {
    const start = vi
      .fn()
      .mockRejectedValue({ code: "DISCONNECTED", message: "Could not reach the Tendril daemon" });
    await renderDialog(stubApi({ start }));

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-start"));
    });

    expect(screen.getByTestId("share-tunnel-error")).toHaveTextContent(
      "Failed to start share tunnel: Could not reach the Tendril daemon",
    );
    expect(screen.getByTestId("share-start")).toBeInTheDocument();
  });

  /** The daemon reports a *retrying* tunnel's reason on the snapshot rather than by rejecting. */
  it("surfaces an error carried on the snapshot", async () => {
    const api = stubApi({
      getStatus: vi.fn().mockResolvedValue({
        ...DISABLED,
        error: "the share tunnel did not become routable within 180s",
      }),
    });
    await renderDialog(api);

    expect(screen.getByTestId("share-tunnel-error")).toHaveTextContent("did not become routable");
  });

  it("reports a failed status read instead of rendering an empty dialog", async () => {
    const api = stubApi({
      getStatus: vi.fn().mockRejectedValue({ code: "DISCONNECTED", message: "daemon is down" }),
    });
    await renderDialog(api);

    expect(screen.getByTestId("share-tunnel-error")).toHaveTextContent("daemon is down");
  });

  it("closes on Escape without touching the tunnel", async () => {
    const onClose = vi.fn();
    const api = stubApi({ getStatus: vi.fn().mockResolvedValue(CONNECTED) });
    await act(async () => {
      render(<ShareTunnelDialog isOpen onClose={onClose} api={api} />);
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.stop).not.toHaveBeenCalled();
  });

  it("does nothing at all while closed", async () => {
    const api = stubApi();
    await act(async () => {
      render(<ShareTunnelDialog isOpen={false} onClose={vi.fn()} api={api} />);
    });
    expect(api.getStatus).not.toHaveBeenCalled();
    expect(screen.queryByTestId("share-tunnel-dialog")).not.toBeInTheDocument();
  });
});

/**
 * The link builder is the one piece of logic duplicated between the frontend and
 * `ShareTunnelService::share_url_for_plan`, so it is pinned against the same strings that Rust test
 * asserts.
 */
describe("shareUrlForPlan", () => {
  it("matches the relative form when no tunnel is up", () => {
    expect(shareUrlForPlan(DISABLED, "00021-Ship-It", true)).toBe(
      "/review?planId=00021-Ship-It&share=1",
    );
    expect(shareUrlForPlan(DISABLED, "00021-Ship-It", false)).toBe(
      "/plans?planId=00021-Ship-It&share=1",
    );
  });

  it("carries the tunnel and the token once connected", () => {
    expect(shareUrlForPlan(CONNECTED, "00021-Ship It", true)).toBe(
      "https://calm-otter.trycloudflare.com/review?planId=00021-Ship%20It&share=1&shareToken=tok-abc",
    );
  });

  it("does not hand out a token while still connecting", () => {
    expect(shareUrlForPlan(CONNECTING, "00021-Ship-It", true)).toBe(
      "/review?planId=00021-Ship-It&share=1",
    );
  });

  it("does not double the slash after a trailing-slash URL", () => {
    expect(
      shareUrlForPlan(
        { ...CONNECTED, url: "https://calm-otter.trycloudflare.com/" },
        "00021",
        true,
      ),
    ).toBe("https://calm-otter.trycloudflare.com/review?planId=00021&share=1&shareToken=tok-abc");
  });
});
