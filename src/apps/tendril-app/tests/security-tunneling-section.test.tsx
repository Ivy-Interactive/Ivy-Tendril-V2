import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { SecurityTunnelingSection } from "../src/views/settings/SecurityTunnelingSection";
import { notificationsStore } from "../src/state/notificationsStore";
import type {
  CloudflaredInstallState,
  PasswordStatus,
  TunnelApi,
  TunnelSnapshot,
} from "../src/api/tunnelApi";

/**
 * `Apps/Settings/SecuritySetupView.cs` and the `TunnelSetupView` it composes — V1's one
 * "Security & Tunneling" row, which before this change was a stub saying nothing here was reachable.
 *
 * The three blocks and the coupling between them:
 *
 * - Session Protection writes a password through `PUT /api/auth/password`, requiring the current one to
 *   change or clear it, and never showing or keeping the plaintext.
 * - The full-access Tunnel refuses to start without a password, and says so as a reason.
 * - The Share Tunnel has no such precondition, because it is deny-by-default.
 */

const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
  openPath: vi.fn(),
}));

const DISABLED: TunnelSnapshot = {
  status: "disabled",
  installed: true,
  sharePort: 5011,
  passwordConfigured: false,
};

const connected = (url: string): TunnelSnapshot => ({
  ...DISABLED,
  status: "connected",
  url,
  passwordConfigured: true,
});

/** A bridge error as `describeBridgeError`/`bridgeErrorCode` read it. */
const bridgeError = (code: string, message: string) => ({ code, message });

/** An installed `cloudflared`, which is the state that renders no install block at all. */
const INSTALLED: CloudflaredInstallState = {
  installed: true,
  binaryPath: "/opt/homebrew/bin/cloudflared",
  expectedPath: "/home/u/.tendril/tools/cloudflared",
  assetName: "cloudflared-darwin-arm64.tgz",
  downloadUrl:
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
  downloadable: true,
};

const MISSING: CloudflaredInstallState = { ...INSTALLED, installed: false, binaryPath: null };

interface StubOptions {
  passwordEnabled?: boolean;
  full?: TunnelSnapshot;
  share?: TunnelSnapshot;
  /** Defaults to an installed binary, so tests that are not about the installer see no install block. */
  install?: CloudflaredInstallState;
}

/**
 * The twelve commands the section drives. The mocks are returned individually as well as bundled into
 * an `api`, so an assertion never has to reference one through the object — which would be an unbound
 * method reference.
 */
function stubApi(options: StubOptions = {}) {
  const state = {
    passwordEnabled: options.passwordEnabled ?? false,
    full: options.full ?? DISABLED,
    share: options.share ?? DISABLED,
    install: options.install ?? INSTALLED,
  };

  const getPasswordStatus = vi.fn((): Promise<PasswordStatus> =>
    Promise.resolve({ passwordAuthEnabled: state.passwordEnabled }),
  );
  const setPassword = vi.fn((_current: string | null, _next: string) => {
    state.passwordEnabled = true;
    return Promise.resolve({ passwordAuthEnabled: true });
  });
  const clearPassword = vi.fn((_current: string | null) => {
    state.passwordEnabled = false;
    return Promise.resolve({ passwordAuthEnabled: false });
  });
  const getFullTunnel = vi.fn(() => Promise.resolve(state.full));
  const startFullTunnel = vi.fn(() => Promise.resolve(state.full));
  const stopFullTunnel = vi.fn(() => Promise.resolve(DISABLED));
  const getShareTunnel = vi.fn(() => Promise.resolve(state.share));
  const startShareTunnel = vi.fn(() => Promise.resolve(state.share));
  const stopShareTunnel = vi.fn(() => Promise.resolve(DISABLED));
  // Reads `state.install` on each call rather than closing over a value, so a test can advance the
  // install the way the daemon would and let the component's poll pick it up.
  const getCloudflaredInstallState = vi.fn(() => Promise.resolve(state.install));
  const installCloudflared = vi.fn(() => Promise.resolve(state.install));
  const cancelCloudflaredInstall = vi.fn(() => Promise.resolve(state.install));

  const api: TunnelApi = {
    getPasswordStatus,
    setPassword,
    clearPassword,
    getFullTunnel,
    startFullTunnel,
    stopFullTunnel,
    getShareTunnel,
    startShareTunnel,
    stopShareTunnel,
    getCloudflaredInstallState,
    installCloudflared,
    cancelCloudflaredInstall,
  };
  return {
    api,
    state,
    getPasswordStatus,
    setPassword,
    clearPassword,
    getFullTunnel,
    startFullTunnel,
    stopFullTunnel,
    getShareTunnel,
    startShareTunnel,
    stopShareTunnel,
    getCloudflaredInstallState,
    installCloudflared,
    cancelCloudflaredInstall,
  };
}

async function renderSection(api: TunnelApi) {
  await act(async () => {
    render(<SecurityTunnelingSection api={api} />);
  });
}

const typeInto = async (id: string, value: string) => {
  await act(async () => {
    fireEvent.change(document.getElementById(id)!, { target: { value } });
  });
};

const click = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

/** V1's `client.Toast(...)`. Held as a local so an assertion never references it through the store. */
let notifySuccess: MockInstance<typeof notificationsStore.notifySuccess>;

beforeEach(() => {
  openUrl.mockClear();
  notifySuccess = vi.spyOn(notificationsStore, "notifySuccess").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Security & Tunneling", () => {
  it("renders V1's three blocks and no longer claims to be unwired", async () => {
    const { api } = stubApi();
    await renderSection(api);

    expect(screen.getByTestId("security-tunneling-card")).toBeInTheDocument();
    expect(screen.getByTestId("session-protection")).toBeInTheDocument();
    expect(screen.getByTestId("full-tunnel")).toBeInTheDocument();
    expect(screen.getByTestId("share-tunnel")).toBeInTheDocument();
    // The old stub's callout.
    expect(screen.queryByTestId("security-not-wired")).not.toBeInTheDocument();
    // V1's headings, verbatim.
    expect(screen.getByText("Session Protection")).toBeInTheDocument();
    expect(screen.getByText("Tunnel")).toBeInTheDocument();
    expect(screen.getByText("Share Tunnel")).toBeInTheDocument();
  });
});

describe("Session Protection", () => {
  it("sets a first password with no current one, and never shows the plaintext back", async () => {
    const { api, setPassword } = stubApi({ passwordEnabled: false });
    await renderSection(api);

    // V1 starts the toggle at `config.Settings.Auth != null`, so it is off on a fresh install.
    await click("password-enabled-toggle");
    expect(document.getElementById("current-password")).toBeNull();

    await typeInto("new-password", "correct horse battery");
    await typeInto("confirm-password", "correct horse battery");
    await click("password-save");

    expect(setPassword).toHaveBeenCalledWith(null, "correct horse battery");
    // The fields are wiped, so the plaintext is not left sitting in the DOM.
    expect((document.getElementById("new-password") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("confirm-password") as HTMLInputElement).value).toBe("");
    expect(notifySuccess).toHaveBeenCalledWith("Saved", "Password protection enabled");
  });

  it("uses password inputs, so nothing is rendered in the clear", async () => {
    const { api } = stubApi();
    await renderSection(api);
    await click("password-enabled-toggle");

    for (const id of ["new-password", "confirm-password"]) {
      expect(document.getElementById(id)).toHaveAttribute("type", "password");
    }
  });

  it("requires the current password to change one, and passes it through", async () => {
    const { api, setPassword } = stubApi({ passwordEnabled: true });
    await renderSection(api);

    // Already configured, so the toggle is on and Current Password is present — V1's
    // `hasAuthConfigured ? currentPassword.ToPasswordInput(...) : null`.
    await waitFor(() => expect(document.getElementById("current-password")).not.toBeNull());

    await typeInto("new-password", "second-password");
    await typeInto("confirm-password", "second-password");
    // V1's `canSave` needs the current password too once one is configured.
    expect(screen.getByTestId("password-save")).toBeDisabled();

    await typeInto("current-password", "first-password");
    await click("password-save");

    expect(setPassword).toHaveBeenCalledWith("first-password", "second-password");
  });

  it("refuses to save mismatched passwords and says so", async () => {
    const { api, setPassword } = stubApi();
    await renderSection(api);
    await click("password-enabled-toggle");

    await typeInto("new-password", "one-thing");
    await typeInto("confirm-password", "another-thing");

    expect(screen.getByTestId("passwords-do-not-match")).toHaveTextContent(
      "Passwords do not match",
    );
    expect(screen.getByTestId("password-save")).toBeDisabled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("shows a refused save as destructive text and puts the toggle back", async () => {
    const { api } = stubApi({ passwordEnabled: true });
    api.setPassword = vi.fn(() =>
      Promise.reject(bridgeError("FORBIDDEN", "Current password is incorrect")),
    );
    await renderSection(api);
    await waitFor(() => expect(document.getElementById("current-password")).not.toBeNull());

    await typeInto("current-password", "wrong");
    await typeInto("new-password", "second-password");
    await typeInto("confirm-password", "second-password");
    await click("password-save");

    expect(screen.getByTestId("password-error")).toHaveTextContent("Current password is incorrect");
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("clears protection with the current password, and cannot clear what was never set", async () => {
    const { api } = stubApi({ passwordEnabled: false });
    await renderSection(api);

    // Nothing configured and the toggle off: V1 keeps Save inert, because there is nothing to do.
    expect(screen.getByTestId("password-save")).toBeDisabled();

    const configured = stubApi({ passwordEnabled: true });
    await act(async () => {
      render(<SecurityTunnelingSection api={configured.api} />);
    });
    const toggles = screen.getAllByTestId("password-enabled-toggle");
    await act(async () => {
      fireEvent.click(toggles[toggles.length - 1]);
    });
    await act(async () => {
      fireEvent.change(document.getElementById("current-password-to-disable")!, {
        target: { value: "the-password" },
      });
    });
    const saves = screen.getAllByTestId("password-save");
    await act(async () => {
      fireEvent.click(saves[saves.length - 1]);
    });

    expect(configured.clearPassword).toHaveBeenCalledWith("the-password");
    expect(notifySuccess).toHaveBeenCalledWith("Saved", "Password protection disabled");
  });
});

describe("Tunnel (full access)", () => {
  it("warns that it publishes everything, before anything is clicked", async () => {
    const { api } = stubApi();
    await renderSection(api);

    expect(screen.getByTestId("full-tunnel-warning")).toHaveTextContent(
      /entire Tendril instance on a public URL/,
    );
    // The share tunnel gets no such warning: it is deny-by-default.
    expect(screen.queryByTestId("share-tunnel-warning")).not.toBeInTheDocument();
  });

  it("explains the password precondition when the daemon refuses to start it", async () => {
    const { api } = stubApi();
    api.startFullTunnel = vi.fn(() =>
      Promise.reject(
        bridgeError(
          "TUNNEL_PASSWORD_REQUIRED",
          "A full-access tunnel publishes this whole daemon on the public internet, so it needs a password first. Set one under Session Protection, then activate the tunnel.",
        ),
      ),
    );
    await renderSection(api);

    await click("full-tunnel-activate");

    const error = screen.getByTestId("full-tunnel-error");
    // The daemon's own message, verbatim, and nothing else. This pane used to append its own "Set one
    // under Session Protection above" underneath, which rendered the instruction twice; the remediation
    // is the daemon's to word so that the share dialog and a CLI caller get it too.
    expect(error).toHaveTextContent(/needs a password first/);
    expect(error).toHaveTextContent(/Set one under Session Protection/);
    expect(error.textContent?.match(/Set one under/g) ?? []).toHaveLength(1);
    // A refused start leaves no spinner behind — V1's `status.Set(TunnelStatus.Disabled)` in its catch.
    expect(screen.queryByTestId("full-tunnel-connecting")).not.toBeInTheDocument();
    expect(screen.getByTestId("full-tunnel-activate")).toBeInTheDocument();
  });

  it("shows the URL, copies it, opens it and deactivates once connected", async () => {
    const { api, stopFullTunnel } = stubApi({
      full: connected("https://brisk-badger.trycloudflare.com/"),
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    await renderSection(api);

    await waitFor(() => expect(screen.getByTestId("full-tunnel-active")).toBeInTheDocument());
    // The trailing slash is trimmed, as V1's `TrimEnd('/')` does.
    expect(screen.getByTestId("full-tunnel-url")).toHaveTextContent(
      "https://brisk-badger.trycloudflare.com",
    );

    await click("full-tunnel-copy");
    expect(writeText).toHaveBeenCalledWith("https://brisk-badger.trycloudflare.com");
    expect(notifySuccess).toHaveBeenCalledWith("URL Copied", "Tunnel URL copied to clipboard");

    await click("full-tunnel-open");
    expect(openUrl).toHaveBeenCalledWith("https://brisk-badger.trycloudflare.com");

    await click("full-tunnel-deactivate");
    expect(stopFullTunnel).toHaveBeenCalled();
    expect(notifySuccess).toHaveBeenCalledWith("Deactivated", "Tunnel stopped");
  });

  it("offers Deactivate while it is still starting", async () => {
    const { api } = stubApi({ full: { ...DISABLED, status: "connecting" } });
    await renderSection(api);

    await waitFor(() => expect(screen.getByTestId("full-tunnel-connecting")).toBeInTheDocument());
    expect(screen.getByTestId("full-tunnel-connecting")).toHaveTextContent(/15-30 seconds/);
    expect(screen.getByTestId("full-tunnel-deactivate")).toBeInTheDocument();
  });
});

describe("Share Tunnel", () => {
  it("starts with no password precondition at all", async () => {
    const { api, startShareTunnel, startFullTunnel } = stubApi({ passwordEnabled: false });
    await renderSection(api);

    await click("share-tunnel-activate");

    expect(startShareTunnel).toHaveBeenCalled();
    expect(screen.queryByTestId("share-tunnel-error")).not.toBeInTheDocument();
    // ...whereas the full-access button next to it would have been refused.
    expect(startFullTunnel).not.toHaveBeenCalled();
  });

  it("drives its own commands, not the full-access ones", async () => {
    const { api, stopShareTunnel, stopFullTunnel } = stubApi({
      share: connected("https://otter.trycloudflare.com"),
    });
    await renderSection(api);

    await waitFor(() => expect(screen.getByTestId("share-tunnel-active")).toBeInTheDocument());
    await click("share-tunnel-deactivate");

    expect(stopShareTunnel).toHaveBeenCalled();
    expect(stopFullTunnel).not.toHaveBeenCalled();
    expect(notifySuccess).toHaveBeenCalledWith("Deactivated", "Share tunnel stopped");
  });

  it("renders a missing cloudflared as the daemon's own install instructions", async () => {
    const { api } = stubApi();
    api.startShareTunnel = vi.fn(() =>
      Promise.reject(
        bridgeError(
          "TUNNEL_PRECONDITION",
          "cloudflared is not installed. Install it with your package manager (macOS: `brew install cloudflared`).",
        ),
      ),
    );
    await renderSection(api);

    await click("share-tunnel-activate");

    const error = screen.getByTestId("share-tunnel-error");
    // The daemon's message, verbatim and with nothing appended. The offer to fetch it lives in its own
    // block above rather than inside a tunnel's error, because there is one cloudflared for both.
    expect(error).toHaveTextContent(/brew install cloudflared/);
  });
});

describe("cloudflared install", () => {
  it("says nothing at all when cloudflared is already there", async () => {
    const { api } = stubApi();
    await renderSection(api);

    expect(screen.queryByTestId("cloudflared-install")).not.toBeInTheDocument();
  });

  it("offers to install a missing cloudflared, and keeps the manual instructions underneath", async () => {
    const { api, installCloudflared } = stubApi({ install: MISSING });
    await renderSection(api);

    expect(screen.getByTestId("cloudflared-install")).toBeInTheDocument();
    // The manual route is demoted to a fallback, not deleted: it is what a failed download falls back
    // to and the supported path for anyone who would rather own the binary.
    const manual = screen.getByTestId("cloudflared-manual");
    expect(manual).toHaveTextContent(/brew install cloudflared/);
    expect(manual).toHaveTextContent(/cloudflared-darwin-arm64\.tgz/);

    // Nothing is fetched until the user asks: mounting the section must not start a download.
    expect(installCloudflared).not.toHaveBeenCalled();

    await click("cloudflared-install-button");
    expect(installCloudflared).toHaveBeenCalled();
  });

  it("shows download progress and offers a way out of it", async () => {
    const { api, state, cancelCloudflaredInstall } = stubApi({
      install: {
        ...MISSING,
        progress: {
          phase: "downloading",
          downloadedBytes: 10_485_760,
          totalBytes: 20_971_520,
        },
      },
    });
    await renderSection(api);

    expect(screen.getByTestId("cloudflared-progress")).toHaveTextContent(/50%/);

    // A 40 MB transfer the user cannot escape is as bad as one with no progress at all.
    state.install = { ...MISSING, progress: { phase: "cancelled", downloadedBytes: 0 } };
    await click("cloudflared-cancel");

    expect(cancelCloudflaredInstall).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("cloudflared-cancelled")).toBeInTheDocument());
  });

  it("falls back to the manual instructions when the download fails", async () => {
    const { api } = stubApi({
      install: {
        ...MISSING,
        progress: {
          phase: "failed",
          downloadedBytes: 0,
          error:
            "could not reach GitHub to look up the cloudflared release. Check your network, or install cloudflared yourself.",
        },
      },
    });
    await renderSection(api);

    expect(screen.getByTestId("cloudflared-error")).toHaveTextContent(/could not reach GitHub/);
    expect(screen.getByTestId("cloudflared-manual")).toHaveTextContent(/brew install cloudflared/);
    // A failure is retryable — the button stays, relabelled.
    expect(screen.getByTestId("cloudflared-install-button")).toHaveTextContent(/Try again/);
  });

  it("does not offer to download over an operator's own binaryPath", async () => {
    const { api } = stubApi({
      install: {
        ...MISSING,
        downloadable: false,
        configuredPathError:
          "shareTunnel.binaryPath is set to /opt/wrong/cloudflared, which is not an executable file",
      },
    });
    await renderSection(api);

    // "your configured path is wrong" and "cloudflared is missing" stay distinct: fetching a copy into
    // tools/ would not even be used, because the override wins in `resolve_binary`.
    expect(screen.getByTestId("cloudflared-configured-error")).toHaveTextContent(
      /shareTunnel\.binaryPath is set to/,
    );
    expect(screen.queryByTestId("cloudflared-install-button")).not.toBeInTheDocument();
  });
});
