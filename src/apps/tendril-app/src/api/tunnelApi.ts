import { invoke } from "@tauri-apps/api/core";

/**
 * The bridge for both tunnels and for the session password — everything V1's
 * `Apps/Settings/SecuritySetupView.cs` and the `TunnelSetupView` it composes drive.
 *
 * V1 calls `ICloudflaredService`, `IShareTunnelService` and `IConfigService` in-process, because there
 * the UI and the server are one process. In V2 they are not: the tunnels are owned by the daemon
 * (`tendril_core::tunnel`) and so is password hashing (`tendril_core::auth::credentials`), so this is a
 * client of `/api/tunnel/**` and `/api/auth/password` like every other feature.
 *
 * Its own module rather than more methods on `bridge.ts`, which is shared ground, and rather than
 * staying inline in `ShareTunnelDialog` — the dialog and the Security & Tunneling section both need the
 * share tunnel's three commands, and one set of `invoke` names is what stops them drifting.
 */

/** `tendril_core::tunnel::TunnelStatus`, as the daemon serialises it. */
export type TunnelStatus = "disabled" | "connecting" | "connected";

/** `tendril_core::tunnel::TunnelKind`. */
export type TunnelKind = "share" | "fullAccess";

/**
 * `tendril_core::tunnel::TunnelSnapshot`. One shape for both tunnels, because it is one struct on the
 * daemon side; `kind` says which one answered.
 */
export interface TunnelSnapshot {
  /** Optional so a snapshot from a daemon that predates the field still type-checks as a share. */
  kind?: TunnelKind;
  status: TunnelStatus;
  url?: string | null;
  /**
   * The visitor's capability token, present only while a *share* is connected. A full-access tunnel
   * mints none: it authorises nothing by existing, and the credential is the operator's password.
   */
  shareToken?: string | null;
  error?: string | null;
  installed: boolean;
  startedAt?: string | null;
  sharePort: number;
  /**
   * Whether a session password is configured. Only meaningful for `fullAccess`, where it is the
   * precondition for starting — the section reads it to explain *why* Activate is unavailable rather
   * than just greying it out.
   */
  passwordConfigured?: boolean;
}

/**
 * `tendril_core::tunnel::installer::InstallProgress`. How a running `cloudflared` download is getting
 * on.
 *
 * `phase` is a plain string rather than a union on the wire, so a daemon that grows a phase does not
 * break an older app; the section treats anything it does not recognise as "working".
 */
export interface CloudflaredInstallProgress {
  phase: string;
  downloadedBytes: number;
  /** Absent when the server sent no `Content-Length`, which is why the bar can be indeterminate. */
  totalBytes?: number | null;
  /** Set only in the `failed` phase. */
  error?: string | null;
}

/**
 * `tendril_core::tunnel::installer::InstallState` — `GET /api/tunnel/share/install`.
 *
 * Both the "is it there?" answer and the progress of a download, because the section polls one endpoint
 * for both rather than opening a stream.
 */
export interface CloudflaredInstallState {
  installed: boolean;
  binaryPath?: string | null;
  expectedPath: string;
  assetName: string;
  /** Where a human would fetch it by hand — the fallback when the download is unavailable or fails. */
  downloadUrl: string;
  /** Whether offering an Install button makes sense at all. */
  downloadable: boolean;
  progress?: CloudflaredInstallProgress | null;
  /**
   * Set when `shareTunnel.binaryPath` points at something unusable. Distinct from `installed: false`:
   * the operator pointed at a binary, so the fix is their config and not a download.
   */
  configuredPathError?: string | null;
}

/** `GET /api/auth/status`, and the reply from `PUT`/`DELETE /api/auth/password`. */
export interface PasswordStatus {
  passwordAuthEnabled: boolean;
  message?: string | null;
}

/**
 * Every command the Security & Tunneling section and the share dialog use, gathered so a test can
 * substitute them.
 *
 * A password crosses this boundary in the `setPassword`/`clearPassword` arguments and nowhere else: the
 * native side puts it straight into a request body, and the daemon hashes it. Nothing here stores it,
 * logs it or reads it back — see `tendril_core::auth::credentials` for why the credential format must not
 * live in the frontend at all.
 */
export const tunnelApi = {
  // --- Share tunnel: V1's `IShareTunnelService` -------------------------------------------------
  async getShareTunnel(): Promise<TunnelSnapshot> {
    return invoke<TunnelSnapshot>("cmd_get_share_tunnel");
  },
  async startShareTunnel(): Promise<TunnelSnapshot> {
    return invoke<TunnelSnapshot>("cmd_start_share_tunnel");
  },
  async stopShareTunnel(): Promise<TunnelSnapshot> {
    return invoke<TunnelSnapshot>("cmd_stop_share_tunnel");
  },

  // --- cloudflared: V1's `CloudflaredInstaller` -------------------------------------------------
  async getCloudflaredInstallState(): Promise<CloudflaredInstallState> {
    return invoke<CloudflaredInstallState>("cmd_get_cloudflared_install_state");
  },
  /**
   * Starts the daemon's download of `cloudflared`. Resolves as soon as it is running, not when it is
   * finished — the caller polls {@link tunnelApi.getCloudflaredInstallState} for progress, the same way
   * it polls a `connecting` tunnel.
   *
   * Only ever called from an explicit Install press. Nothing fetches on app start.
   */
  async installCloudflared(): Promise<CloudflaredInstallState> {
    return invoke<CloudflaredInstallState>("cmd_install_cloudflared");
  },
  /** Cancels a running download. Installs nothing and removes nothing already installed. */
  async cancelCloudflaredInstall(): Promise<CloudflaredInstallState> {
    return invoke<CloudflaredInstallState>("cmd_cancel_cloudflared_install");
  },

  // --- Full-access tunnel: V1's `ICloudflaredService` -------------------------------------------
  async getFullTunnel(): Promise<TunnelSnapshot> {
    return invoke<TunnelSnapshot>("cmd_get_full_tunnel");
  },
  /**
   * Rejects with a `TUNNEL_PASSWORD_REQUIRED` bridge error when no session password is configured. V1
   * has no such check; see `tendril_core::tunnel::TunnelService::start` for why V2 does.
   */
  async startFullTunnel(): Promise<TunnelSnapshot> {
    return invoke<TunnelSnapshot>("cmd_start_full_tunnel");
  },
  async stopFullTunnel(): Promise<TunnelSnapshot> {
    return invoke<TunnelSnapshot>("cmd_stop_full_tunnel");
  },

  // --- Session password: V1's `SecuritySetupView` Save button -----------------------------------
  async getPasswordStatus(): Promise<PasswordStatus> {
    return invoke<PasswordStatus>("cmd_get_password_status");
  },
  async setPassword(currentPassword: string | null, newPassword: string): Promise<PasswordStatus> {
    return invoke<PasswordStatus>("cmd_set_password", { currentPassword, newPassword });
  },
  async clearPassword(currentPassword: string | null): Promise<PasswordStatus> {
    return invoke<PasswordStatus>("cmd_clear_password", { currentPassword });
  },
};

export type TunnelApi = typeof tunnelApi;
