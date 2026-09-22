import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyToClipboard } from "@ivy-interactive/components";
import { Button, Callout, Spinner } from "@ivy-interactive/components/ui";
import { ClipboardCopy, ExternalLink, Share2 } from "lucide-react";
import { describeBridgeError, bridgeErrorCode } from "../../types/api";
import { notificationsStore } from "../../state/notificationsStore";
import { tunnelApi, type TunnelSnapshot, type TunnelStatus } from "../../api/tunnelApi";
import { DialogShell } from "@ivy-interactive/components/tendril";

/** `tendril_core::tunnel::TunnelStatus`, as the daemon serialises it. */
export type ShareTunnelStatus = TunnelStatus;

/** `GET /api/tunnel/share`'s payload, via `cmd_get_share_tunnel`. */
export type ShareTunnelSnapshot = TunnelSnapshot;

/**
 * The three commands this dialog drives, gathered so a test can substitute them.
 *
 * Delegates to `src/api/tunnelApi.ts`, which is where the `invoke` names live now that the Security &
 * Tunneling section needs the same three. The narrow `getStatus`/`start`/`stop` shape is kept because it
 * is what this dialog's `api` prop is typed on.
 */
export const shareTunnelApi = {
  getStatus: (): Promise<ShareTunnelSnapshot> => tunnelApi.getShareTunnel(),
  start: (): Promise<ShareTunnelSnapshot> => tunnelApi.startShareTunnel(),
  stop: (): Promise<ShareTunnelSnapshot> => tunnelApi.stopShareTunnel(),
};

export type ShareTunnelApi = typeof shareTunnelApi;

/** How often a `connecting` tunnel is re-read. V1 gets pushed `StatusChanged`; V2 polls. */
export const SHARE_POLL_INTERVAL_MS = 2000;

/**
 * The link a reviewer is sent.
 *
 * Mirrors `ShareTunnelService::share_url_for_plan` in `tendril-core`, which is the authority and is
 * tested against the same strings. Two rules from it:
 *
 * - `?share=1` is what puts the page in share mode, matching V1's `ShareContext.IsShareMode`, and
 * - `shareToken` is V2's addition. An anonymous visitor has no bearer credential and V2 refuses
 *   unauthenticated requests, so the capability token has to travel in the link.
 *
 * With no tunnel the relative path is returned, exactly as V1 does, so a caller can render a link
 * before a share exists.
 */
export function shareUrlForPlan(
  snapshot: Pick<ShareTunnelSnapshot, "status" | "url" | "shareToken">,
  planId: string,
  isReview: boolean,
): string {
  const path = isReview ? "/review" : "/plans";
  let query = `?planId=${encodeURIComponent(planId)}&share=1`;
  const connected = snapshot.status === "connected";
  if (connected && snapshot.shareToken) {
    query += `&shareToken=${snapshot.shareToken}`;
  }
  if (connected && snapshot.url) {
    return `${snapshot.url.replace(/\/+$/, "")}${path}${query}`;
  }
  return `${path}${query}`;
}

export interface ShareTunnelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The plan to deep-link to, by id. V1's `ShareTunnelModal(planFolderName, isReview)` — V1 passes a
   * folder name because its router resolves either; V2's routes key on the id. With none, the dialog
   * shares the tunnel root.
   */
  planId?: string;
  /** V1's `isReview`: `true` links into Review, `false` into Plans. */
  isReview?: boolean;
  /** Injected in tests. */
  api?: ShareTunnelApi;
}

/**
 * Port of `Apps/Views/Dialogs/ShareTunnelModal.cs`.
 *
 * V1's state machine, kept as-is:
 *
 * | state | what is shown |
 * |---|---|
 * | `disabled` | the explanation and a single **Start Share Tunnel** button |
 * | `connecting` | an info callout, "this typically takes 15-30 seconds", and a spinner |
 * | `connected` | the URL, **Copy Link**, **Open in Browser** and **Stop Sharing** |
 *
 * plus an error callout above all three whenever the daemon reports one, which is V1's
 * `if (error.Value is not null) content |= Callout.Error(...)`.
 *
 * Three deliberate departures, each because V2 is not V1:
 *
 * 1. **No install prompt.** V1 offers to download `cloudflared` from GitHub and run it. Here a missing
 *    binary is the daemon's `409`, and its message — which names the package-manager command and the
 *    release asset — is rendered verbatim. See `tendril_core::tunnel::installer`.
 * 2. **Polling instead of `StatusChanged`.** V1 subscribes to a service event in-process. The daemon is
 *    a separate process (and may be a separate machine), so a `connecting` tunnel is re-read every
 *    {@link SHARE_POLL_INTERVAL_MS}ms and the poll stops the moment the dialog closes or the status
 *    settles.
 * 3. **No QR code.** V1 renders one via `Ivy.Widgets.QRCode`; V2 has no QR component or dependency, and
 *    adding one is not this change's business. Copy Link and Open in Browser are both present.
 */
export function ShareTunnelDialog({
  isOpen,
  onClose,
  planId,
  isReview = true,
  api = shareTunnelApi,
}: ShareTunnelDialogProps) {
  const [snapshot, setSnapshot] = React.useState<ShareTunnelSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isBusy, setIsBusy] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  const status: ShareTunnelStatus = snapshot?.status ?? "disabled";
  // The daemon's own error survives a re-read; a local one (a rejected command) is set beside it. V1
  // shows whichever it has, from the same callout.
  const shownError = error ?? snapshot?.error ?? null;

  // Read on open, and keep reading while the tunnel is coming up. `cancelled` is what stops a reply
  // that arrives after the dialog closed from reopening a spinner.
  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      try {
        const next = await api.getStatus();
        if (cancelled) return;
        setSnapshot(next);
        if (next.status === "connecting") {
          timer = setTimeout(() => void read(), SHARE_POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(describeBridgeError(err));
      }
    };

    setError(null);
    void read();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isOpen, api]);

  const targetUrl = React.useMemo(() => {
    if (snapshot === null || snapshot.status !== "connected" || !snapshot.url) return null;
    return planId ? shareUrlForPlan(snapshot, planId, isReview) : snapshot.url.replace(/\/+$/, "");
  }, [snapshot, planId, isReview]);

  const handleStart = async () => {
    setIsBusy(true);
    setError(null);
    // Optimistically show the "starting" callout, as V1 does with `status.Set(Connecting)` before it
    // awaits — a share takes long enough that a dead-looking button is worse than a wrong one.
    setSnapshot((current) => ({
      status: "connecting",
      installed: current?.installed ?? true,
      sharePort: current?.sharePort ?? 0,
    }));
    try {
      setSnapshot(await api.start());
    } catch (err) {
      // Back to disabled on failure: V1's `status.Set(TunnelStatus.Disabled)` in its catch. A refused
      // start has started nothing, so leaving a spinner up would be a lie.
      setSnapshot((current) =>
        current === null
          ? null
          : { ...current, status: "disabled", url: null, shareToken: null, error: null },
      );
      setError(
        bridgeErrorCode(err) === "TUNNEL_PRECONDITION"
          ? describeBridgeError(err)
          : `Failed to start share tunnel: ${describeBridgeError(err)}`,
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleStop = async () => {
    setIsBusy(true);
    setError(null);
    try {
      setSnapshot(await api.stop());
      notificationsStore.notifySuccess("Deactivated", "Share tunnel stopped");
    } catch (err) {
      setError(`Failed to stop share tunnel: ${describeBridgeError(err)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopy = async () => {
    if (targetUrl === null) return;
    try {
      await copyToClipboard(targetUrl);
      notificationsStore.notifySuccess("Link Copied", "Share URL copied to clipboard");
    } catch (err) {
      setError(`Could not copy the link: ${describeBridgeError(err)}`);
    }
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      // V1's `new DialogHeader("Share Work")` and `.Width(Size.Rem(32))`.
      title="Share Work"
      testId="share-tunnel-dialog"
      width="rem32"
      initialFocusRef={closeRef}
      // Deliberately no `shortcut`, unlike the rest of the dialog family. `DialogShellProps`
      // documents the chord as belonging to "the primary footer button", and this footer holds only
      // Close — a decline, which Escape already owns. The real actions are in the body and they are
      // status-dependent: Start Share Tunnel while `disabled`, Stop Sharing while `connected`. One
      // chord over the pair would mean the same keystroke starts a tunnel in one state and tears it
      // down in another, which is a worse affordance than none. If a hint is ever wanted here it
      // belongs on those two body buttons with their own explicit bindings, not on the shell.
      footer={
        <Button ref={closeRef} variant="outline" onClick={onClose} data-testid="dialog-close">
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* V1's opening `Text.P(...)`, verbatim. */}
        <p className="text-muted-foreground">
          Share your work with teammates via a secure, read-only Cloudflare tunnel. Reviewers can
          inspect plans, diffs, and leave comments without having access to your terminal or
          settings.
        </p>

        {/* V1's `Callout.Error(error.Value, "Error")`. `Callout` already carries `role="alert"` for the
            error variant, so it is both the shared component and the accessible one. */}
        {shownError !== null && (
          <Callout variant="error" title="Error" data-testid="share-tunnel-error">
            {shownError}
          </Callout>
        )}

        {status === "connecting" && (
          <Callout variant="info" title="Tunnel Starting" data-testid="share-tunnel-connecting">
            <div className="flex items-center gap-2">
              <Spinner size="md" aria-hidden="true" />
              <span>Starting share tunnel... This typically takes 15-30 seconds.</span>
            </div>
          </Callout>
        )}

        {status === "connected" && targetUrl !== null && (
          <Callout variant="success" title="Share Active" data-testid="share-tunnel-active">
            <div className="space-y-3">
              <p>Your share tunnel is active with read-only &amp; comment-only permissions.</p>
              <p
                className="break-all rounded-field border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
                data-testid="share-tunnel-url"
              >
                {targetUrl}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void handleCopy()}
                  data-testid="share-copy"
                >
                  <ClipboardCopy className="size-4" aria-hidden="true" />
                  Copy Link
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void openUrl(targetUrl)}
                  data-testid="share-open"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Open in Browser
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={() => void handleStop()}
                disabled={isBusy}
                data-testid="share-stop"
              >
                Stop Sharing
              </Button>
            </div>
          </Callout>
        )}

        {status === "disabled" && (
          <Button onClick={() => void handleStart()} disabled={isBusy} data-testid="share-start">
            <Share2 className="size-4" aria-hidden="true" />
            Start Share Tunnel
          </Button>
        )}
      </div>
    </DialogShell>
  );
}
