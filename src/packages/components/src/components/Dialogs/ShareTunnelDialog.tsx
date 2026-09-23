import * as React from "react";
import { copyToClipboard } from "../../lib/clipboard";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Spinner } from "../ui/spinner";
import { ClipboardCopy, ExternalLink, Share2 } from "lucide-react";
import { useTranslation } from "@/i18n/uiDialogs";
import { DialogShell } from "./DialogShell";

/** Fallback error text. Module scope for the same reason as in `PlanSearchDialog`. */
const describeErrorFallback = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** `tendril_core::tunnel::TunnelStatus`, as the daemon serialises it. */
export type ShareTunnelStatus = "disabled" | "connecting" | "connected";

/** `GET /api/tunnel/share`'s payload, via `cmd_get_share_tunnel`. */
/**
 * A share tunnel's state, as this dialog renders it.
 *
 * Declared here rather than imported from the app's `TunnelSnapshot`, for the reason `PlanGitView`
 * gives for owning its own shapes. The app's DTO is structurally compatible and passes straight
 * through.
 */
export interface ShareTunnelSnapshot {
  kind?: string;
  status: ShareTunnelStatus;
  url?: string | null;
  /** The visitor's capability token, present only while a share is connected. */
  shareToken?: string | null;
  error?: string | null;
  installed: boolean;
  startedAt?: string | null;
  sharePort: number;
}

/**
 * The three commands this dialog drives, gathered so a test can substitute them.
 *
 * Delegates to `src/api/tunnelApi.ts`, which is where the `invoke` names live now that the Security &
 * Tunneling section needs the same three. The narrow `getStatus`/`start`/`stop` shape is kept because it
 * is what this dialog's `api` prop is typed on.
 */

export interface ShareTunnelApi {
  getStatus: () => Promise<ShareTunnelSnapshot>;
  start: () => Promise<ShareTunnelSnapshot>;
  stop: () => Promise<ShareTunnelSnapshot>;
}

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
  /** The tunnel API. Required: the library cannot reach the daemon, so the app supplies it. */
  api: ShareTunnelApi;
  /** Announces a completed action. The app routes it through its notifications store. */
  onNotify?: (title: string, message: string) => void;
  /** Opens the share link outside the app. Tauri's opener in the desktop shell. */
  onOpenUrl?: (url: string) => void;
  /**
   * Turns a rejection into a message, and names its code.
   *
   * Injected because the daemon's error envelope is the app's to read. The code matters for one
   * case: `TUNNEL_PRECONDITION` is already a complete sentence from the daemon, so prefixing it
   * with "Failed to start share tunnel" would say the same thing twice.
   */
  describeError?: (err: unknown) => string;
  errorCode?: (err: unknown) => string | undefined;
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
  api,
  onNotify,
  onOpenUrl,
  describeError = describeErrorFallback,
  errorCode = () => undefined,
}: ShareTunnelDialogProps) {
  const { t } = useTranslation("uiDialogs");
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
        setError(describeError(err));
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
        errorCode(err) === "TUNNEL_PRECONDITION"
          ? describeError(err)
          : t("shareTunnel.errors.start", { error: describeError(err) }),
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
      onNotify?.(
        t("shareTunnel.notifications.stoppedTitle"),
        t("shareTunnel.notifications.stoppedMessage"),
      );
    } catch (err) {
      setError(t("shareTunnel.errors.stop", { error: describeError(err) }));
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopy = async () => {
    if (targetUrl === null) return;
    try {
      await copyToClipboard(targetUrl);
      onNotify?.(
        t("shareTunnel.notifications.copiedTitle"),
        t("shareTunnel.notifications.copiedMessage"),
      );
    } catch (err) {
      setError(t("shareTunnel.errors.copy", { error: describeError(err) }));
    }
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      // V1's `new DialogHeader("Share Work")` and `.Width(Size.Rem(32))`.
      title={t("shareTunnel.title")}
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
          {t("actions.close")}
        </Button>
      }
    >
      <div className="space-y-4">
        {/* V1's opening `Text.P(...)`, verbatim. */}
        <p className="text-muted-foreground">{t("shareTunnel.intro")}</p>

        {/* V1's `Callout.Error(error.Value, "Error")`. `Callout` already carries `role="alert"` for the
            error variant, so it is both the shared component and the accessible one. */}
        {shownError !== null && (
          <Callout
            variant="error"
            title={t("shareTunnel.errorTitle")}
            data-testid="share-tunnel-error"
          >
            {shownError}
          </Callout>
        )}

        {status === "connecting" && (
          <Callout
            variant="info"
            title={t("shareTunnel.connecting.title")}
            data-testid="share-tunnel-connecting"
          >
            <div className="flex items-center gap-2">
              <Spinner size="md" aria-hidden="true" />
              <span>{t("shareTunnel.connecting.body")}</span>
            </div>
          </Callout>
        )}

        {status === "connected" && targetUrl !== null && (
          <Callout
            variant="success"
            title={t("shareTunnel.active.title")}
            data-testid="share-tunnel-active"
          >
            <div className="space-y-3">
              <p>{t("shareTunnel.active.body")}</p>
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
                  {t("shareTunnel.copyLink")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onOpenUrl?.(targetUrl)}
                  data-testid="share-open"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t("shareTunnel.openInBrowser")}
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={() => void handleStop()}
                disabled={isBusy}
                data-testid="share-stop"
              >
                {t("shareTunnel.stop")}
              </Button>
            </div>
          </Callout>
        )}

        {status === "disabled" && (
          <Button onClick={() => void handleStart()} disabled={isBusy} data-testid="share-start">
            <Share2 className="size-4" aria-hidden="true" />
            {t("shareTunnel.start")}
          </Button>
        )}
      </div>
    </DialogShell>
  );
}
