import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Callout, Input, Label, Switch } from "@ivy-interactive/components/ui";
import { ClipboardCopy, ExternalLink, Loader2 } from "lucide-react";
import {
  tunnelApi,
  type TunnelApi,
  type TunnelSnapshot,
  type TunnelStatus,
} from "../../api/tunnelApi";
import { notificationsStore } from "../../state/notificationsStore";
import { bridgeErrorCode, describeBridgeError } from "../../types/api";
import { SettingsSection } from "./fields";

/**
 * Port of `Apps/Settings/SecuritySetupView.cs` and the `TunnelSetupView` it composes underneath itself
 * — V1's one "Security & Tunneling" row (`SettingsApp.cs:82`, `Icons.Lock`, with `TagSecurity` and
 * `TagTunnel` both resolving here).
 *
 * Three blocks, in V1's order:
 *
 * 1. **Session Protection** — `SecuritySetupView`. Enable/disable, current/new/confirm password, Save.
 * 2. **Tunnel** — `TunnelSetupView`'s first block (`Text.Block("Tunnel").Bold()`), the full-access
 *    tunnel: Activate, the Starting and Active callouts, Copy URL, Open in Browser, Deactivate.
 * 3. **Share Tunnel** — `TunnelSetupView`'s second block, the read-only one, with the same states.
 *
 * # Why the two tunnels are not the same control twice
 *
 * The share tunnel is deny-by-default: a capability token bound to the tunnel host and to a read-only
 * route allow-list, with the daemon's unauthenticated surface refused on the share host. It is safe to
 * hand to somebody who is not the operator, which is its whole purpose.
 *
 * A full-access tunnel publishes the *whole* daemon. It grants nothing by existing — every route still
 * needs a credential — but the bearer secret lives in `.master` on the daemon's machine, so a session
 * password is both the only credential a remote caller can hold and the only thing making the exposure
 * defensible. The daemon therefore refuses to start one without a password
 * (`tendril_core::tunnel::TunnelService::start`), which is a deliberate divergence from V1: V1's
 * Activate button calls straight through, because V1 renders its UI server-side and a browser session is
 * enough there. This section surfaces that as a reason rather than a greyed-out button.
 *
 * Two other departures from V1, both because V2 is not V1:
 *
 * - **No install prompt.** V1 offers to download `cloudflared` from GitHub and run it. Here a missing
 *   binary is the daemon's `409` and its message — which names the package-manager command and the
 *   release asset — is rendered verbatim. See `tendril_core::tunnel::installer`.
 * - **Polling instead of `StatusChanged`.** V1 subscribes to an in-process event. The daemon is a
 *   separate process (and may be a separate machine), so a `connecting` tunnel is re-read every
 *   {@link TUNNEL_POLL_INTERVAL_MS}ms and the poll stops when the status settles or the section unmounts.
 *
 * V1 renders a QR code for each tunnel via `Ivy.Widgets.QRCode`; V2 has no QR component or dependency,
 * and Copy URL plus Open in Browser cover the same job. V1 also hides the Share Tunnel block behind
 * `BetaHelper.IsBeta`; V2's share tunnel is a shipped, ungated feature (`ShareTunnelDialog`), so gating
 * it here would contradict the rest of this build.
 */

/** How often a `connecting` tunnel is re-read. Matches `ShareTunnelDialog`'s interval. */
export const TUNNEL_POLL_INTERVAL_MS = 2000;

const DISABLED_SNAPSHOT: TunnelSnapshot = {
  status: "disabled",
  installed: true,
  sharePort: 0,
};

export interface SecurityTunnelingSectionProps {
  /** Injected in tests. */
  api?: TunnelApi;
}

export const SecurityTunnelingSection: React.FC<SecurityTunnelingSectionProps> = ({
  api = tunnelApi,
}) => (
  <SettingsSection
    title="Security & Tunneling"
    hint="Require a password to access Tendril, and expose this instance over a public tunnel."
    testId="security-tunneling-card"
  >
    <div className="space-y-6">
      <SessionProtectionBlock api={api} />
      <TunnelBlock api={api} kind="full" />
      <TunnelBlock api={api} kind="share" />
    </div>
  </SettingsSection>
);

/* -------------------------------------------------------------------------------------------------
 * Session Protection — `SecuritySetupView`
 * ------------------------------------------------------------------------------------------------- */

/**
 * V1's `SecuritySetupView.Build`, field for field.
 *
 * The one thing V1 does that this cannot: V1 hashes with Argon2 in the same process and assigns
 * `config.Settings.Auth`. Here the plaintext goes to `PUT /api/auth/password` and the daemon hashes it,
 * so the credential format never enters the webview. Nothing in this component logs a password, keeps one
 * after a submit, or reads one back.
 */
const SessionProtectionBlock: React.FC<{ api: TunnelApi }> = ({ api }) => {
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isBusy, setIsBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await api.getPasswordStatus();
        if (cancelled) return;
        setConfigured(status.passwordAuthEnabled);
        // V1's `UseState(config.Settings.Auth != null)`: the toggle starts where the config is.
        setEnabled(status.passwordAuthEnabled);
      } catch (err) {
        if (cancelled) return;
        setConfigured(false);
        setError(describeBridgeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const clearFields = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const passwordsMatch = next === confirm;
  const hasAuth = configured === true;
  // V1's `canSave`, and its `.Disabled(!canSave && isEnabled || (!isEnabled && !hasAuthConfigured))` —
  // turning protection off when it was never on is a no-op, so the button stays inert.
  const canSave = enabled
    ? next.trim().length > 0 && passwordsMatch && (!hasAuth || current.length > 0)
    : hasAuth;

  const handleSave = async () => {
    setIsBusy(true);
    setError(null);
    try {
      if (!enabled) {
        await api.clearPassword(hasAuth ? current : null);
        setConfigured(false);
        notificationsStore.notifySuccess("Saved", "Password protection disabled");
      } else {
        await api.setPassword(hasAuth ? current : null, next);
        setConfigured(true);
        notificationsStore.notifySuccess("Saved", "Password protection enabled");
      }
      clearFields();
    } catch (err) {
      // V1 shows a failed save as destructive body text under the fields, not as a toast, and its
      // message for a bad current password is the daemon's own.
      setError(describeBridgeError(err));
      // The toggle is a view of the config, so a refused change must not leave it lying.
      setEnabled(configured === true);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section className="space-y-3" data-testid="session-protection">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Session Protection</h3>
        <p className="text-xs text-muted-foreground">
          Require a password to access the Tendril interface.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="enable-password-protection"
          checked={enabled}
          disabled={configured === null || isBusy}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            setError(null);
            if (!checked) {
              setNext("");
              setConfirm("");
            }
          }}
          data-testid="password-enabled-toggle"
        />
        <Label htmlFor="enable-password-protection" className="text-sm text-foreground">
          Enable Password Protection
        </Label>
      </div>

      {enabled && (
        <div className="space-y-3">
          {/* V1 shows Current Password only when one is already configured. */}
          {hasAuth && (
            <PasswordField
              id="current-password"
              label="Current Password"
              placeholder="Current password..."
              value={current}
              onChange={setCurrent}
              disabled={isBusy}
            />
          )}
          <PasswordField
            id="new-password"
            label="New Password"
            placeholder="New password..."
            value={next}
            onChange={setNext}
            disabled={isBusy}
            autoComplete="new-password"
          />
          <PasswordField
            id="confirm-password"
            label="Confirm Password"
            placeholder="Confirm password..."
            value={confirm}
            onChange={setConfirm}
            disabled={isBusy}
            autoComplete="new-password"
          />
          {/* V1's `Text.Block("Passwords do not match").Color(Colors.Destructive)`, shown only once
              something has been typed into Confirm. */}
          {!passwordsMatch && confirm.trim().length > 0 && (
            <p className="text-xs text-destructive" data-testid="passwords-do-not-match">
              Passwords do not match
            </p>
          )}
        </div>
      )}

      {/* Turning protection off needs the current password too, so somebody at an unlocked session
          cannot remove the lock without knowing it — V1's `VerifyCurrentPassword` on its disable path. */}
      {!enabled && hasAuth && (
        <PasswordField
          id="current-password-to-disable"
          label="Current Password"
          placeholder="Current password..."
          value={current}
          onChange={setCurrent}
          disabled={isBusy}
        />
      )}

      {error !== null && (
        <p className="text-xs text-destructive" data-testid="password-error">
          {error}
        </p>
      )}

      <Button
        onClick={() => void handleSave()}
        disabled={!canSave || isBusy || configured === null}
        data-testid="password-save"
      >
        Save
      </Button>
    </section>
  );
};

/**
 * A labelled password input. Local rather than added to `fields.tsx` because this is the only screen
 * with one, and `fields.tsx` is shared ground.
 */
const PasswordField: React.FC<{
  id: string;
  label: string;
  placeholder: string;
  value: string;
  disabled?: boolean;
  autoComplete?: string;
  onChange: (value: string) => void;
}> = ({ id, label, placeholder, value, disabled, autoComplete, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <Input
      id={id}
      type="password"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete ?? "current-password"}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
);

/* -------------------------------------------------------------------------------------------------
 * Tunnel and Share Tunnel — `TunnelSetupView`
 * ------------------------------------------------------------------------------------------------- */

type BlockKind = "full" | "share";

/** V1 gives each block its own heading, blurb and callout titles; the state machine is identical. */
const COPY: Record<
  BlockKind,
  {
    heading: string;
    blurb: string;
    startingTitle: string;
    activeTitle: string;
    activeBody: string;
    startingBody: string;
    stoppedToast: string;
    copiedToast: string;
    testId: string;
  }
> = {
  full: {
    heading: "Tunnel",
    blurb:
      "Expose your Tendril instance to the internet via a Cloudflare tunnel. Useful for accessing Tendril from mobile devices or sharing with others.",
    startingTitle: "Tunnel Starting",
    activeTitle: "Tunnel Active",
    activeBody: "Your tunnel is running and accessible at the URL below.",
    startingBody:
      "Starting tunnel and waiting for it to become routable. This typically takes 15-30 seconds.",
    stoppedToast: "Tunnel stopped",
    copiedToast: "Tunnel URL copied to clipboard",
    testId: "full-tunnel",
  },
  share: {
    heading: "Share Tunnel",
    blurb:
      "Expose a read-only, comment-only version of Tendril for team members to review plans and drafts.",
    startingTitle: "Share Tunnel Starting",
    activeTitle: "Share Tunnel Active",
    activeBody: "Your share tunnel is running and accessible at the URL below.",
    startingBody:
      "Starting share tunnel and waiting for it to become routable. This typically takes 15-30 seconds.",
    stoppedToast: "Share tunnel stopped",
    copiedToast: "Share tunnel URL copied to clipboard",
    testId: "share-tunnel",
  },
};

const TunnelBlock: React.FC<{ api: TunnelApi; kind: BlockKind }> = ({ api, kind }) => {
  const copy = COPY[kind];
  const [snapshot, setSnapshot] = React.useState<TunnelSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = React.useState(false);
  const [isBusy, setIsBusy] = React.useState(false);

  const read = React.useCallback(
    () => (kind === "full" ? api.getFullTunnel() : api.getShareTunnel()),
    [api, kind],
  );

  // Read on mount, and keep reading while the tunnel is coming up. `cancelled` is what stops a reply
  // arriving after unmount from reopening a spinner.
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const nextSnapshot = await read();
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        if (nextSnapshot.status === "connecting") {
          timer = setTimeout(() => void poll(), TUNNEL_POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(describeBridgeError(err));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [read]);

  const status: TunnelStatus = snapshot?.status ?? "disabled";
  // V1 shows the service's own error only while the tunnel is down
  // (`if (error.Value is not null && status.Value == TunnelStatus.Disabled)`); a local one — a rejected
  // command — is shown whenever there is one.
  const shownError = error ?? (status === "disabled" ? (snapshot?.error ?? null) : null);
  const url = status === "connected" && snapshot?.url ? snapshot.url.replace(/\/+$/, "") : null;

  const handleActivate = async () => {
    setIsBusy(true);
    setError(null);
    setNeedsPassword(false);
    // V1 sets `Connecting` before it awaits — a tunnel takes long enough that a dead-looking button is
    // worse than an optimistic one.
    setSnapshot((live) => ({ ...(live ?? DISABLED_SNAPSHOT), status: "connecting" }));
    try {
      setSnapshot(await (kind === "full" ? api.startFullTunnel() : api.startShareTunnel()));
    } catch (err) {
      // V1's `status.Set(TunnelStatus.Disabled)` in its catch: a refused start has started nothing, so
      // leaving a spinner up would be a lie.
      setSnapshot((live) =>
        live === null
          ? null
          : { ...live, status: "disabled", url: null, shareToken: null, error: null },
      );
      const code = bridgeErrorCode(err);
      // The one refusal that is a decision rather than a failure. Its message already says what to do,
      // so it is shown verbatim and the block adds a pointer to the form above it.
      setNeedsPassword(code === "TUNNEL_PASSWORD_REQUIRED");
      setError(
        code === "TUNNEL_PASSWORD_REQUIRED" || code === "TUNNEL_PRECONDITION"
          ? describeBridgeError(err)
          : `Failed to start ${copy.heading.toLowerCase()}: ${describeBridgeError(err)}`,
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeactivate = async () => {
    setIsBusy(true);
    setError(null);
    try {
      setSnapshot(await (kind === "full" ? api.stopFullTunnel() : api.stopShareTunnel()));
      notificationsStore.notifySuccess("Deactivated", copy.stoppedToast);
    } catch (err) {
      setError(`Failed to stop ${copy.heading.toLowerCase()}: ${describeBridgeError(err)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopy = async () => {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      notificationsStore.notifySuccess("URL Copied", copy.copiedToast);
    } catch (err) {
      setError(`Could not copy the URL: ${describeBridgeError(err)}`);
    }
  };

  const deactivateButton = (
    <Button
      variant="outline"
      onClick={() => void handleDeactivate()}
      disabled={isBusy}
      data-testid={`${copy.testId}-deactivate`}
    >
      Deactivate
    </Button>
  );

  return (
    <section className="space-y-3" data-testid={copy.testId}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{copy.heading}</h3>
        <p className="text-xs text-muted-foreground">{copy.blurb}</p>
      </div>

      {/* The pairing that gives this section its name, said before it is needed rather than only as a
          refusal: a full-access tunnel is the whole daemon, and the password is what makes it safe. */}
      {kind === "full" && status === "disabled" && (
        <Callout
          variant="warning"
          title="This publishes everything"
          data-testid="full-tunnel-warning"
        >
          <p className="text-xs">
            A full-access tunnel puts this entire Tendril instance on a public URL. Anyone with the
            address and the session password can use it as if they were sitting at this machine, so
            a password is required before one will start. The Share Tunnel below is the read-only
            option.
          </p>
        </Callout>
      )}

      {/* V1's `Callout.Error(error.Value, "Error")`. `Callout` carries `role="alert"` for the error and
          warning variants, so it is both the shared component and the accessible one. */}
      {shownError !== null && (
        <Callout variant="error" title="Error" data-testid={`${copy.testId}-error`}>
          <div className="space-y-1">
            <p>{shownError}</p>
            {needsPassword && (
              <p className="text-xs">
                Set one under <strong>Session Protection</strong> above, then activate the tunnel.
              </p>
            )}
          </div>
        </Callout>
      )}

      {status === "connecting" && (
        <Callout
          variant="info"
          title={copy.startingTitle}
          data-testid={`${copy.testId}-connecting`}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>{copy.startingBody}</span>
            </div>
            {deactivateButton}
          </div>
        </Callout>
      )}

      {status === "connected" && url !== null && (
        <Callout variant="success" title={copy.activeTitle} data-testid={`${copy.testId}-active`}>
          <div className="space-y-3">
            <p>{copy.activeBody}</p>
            <p
              className="break-all rounded-field border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
              data-testid={`${copy.testId}-url`}
            >
              {url}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void handleCopy()}
                data-testid={`${copy.testId}-copy`}
              >
                <ClipboardCopy className="size-4" aria-hidden="true" />
                Copy URL
              </Button>
              <Button
                variant="outline"
                onClick={() => void openUrl(url)}
                data-testid={`${copy.testId}-open`}
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open in Browser
              </Button>
            </div>
            {deactivateButton}
          </div>
        </Callout>
      )}

      {status === "disabled" && (
        <Button
          onClick={() => void handleActivate()}
          disabled={isBusy || snapshot === null}
          data-testid={`${copy.testId}-activate`}
        >
          Activate
        </Button>
      )}
    </section>
  );
};
