import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ShareTunnelDialog as ShareTunnelDialogView,
  shareUrlForPlan,
  SHARE_POLL_INTERVAL_MS,
  type ShareTunnelApi,
  type ShareTunnelSnapshot,
  type ShareTunnelStatus,
} from "@ivy-interactive/components/dialogs";
import { notificationsStore } from "../../state/notificationsStore";
import { describeBridgeError, bridgeErrorCode } from "../../types/api";
import { tunnelApi } from "../../api/tunnelApi";

export { shareUrlForPlan, SHARE_POLL_INTERVAL_MS };
export type { ShareTunnelApi, ShareTunnelSnapshot, ShareTunnelStatus };

/**
 * The live share-tunnel API.
 *
 * Delegates to `src/api/tunnelApi.ts`, which is where the `invoke` names live now that the Security
 * & Tunneling section needs the same three. The narrow `getStatus`/`start`/`stop` shape is kept
 * because it is what the dialog's `api` prop is typed on.
 */
export const shareTunnelApi: ShareTunnelApi = {
  getStatus: () => tunnelApi.getShareTunnel(),
  start: () => tunnelApi.startShareTunnel(),
  stop: () => tunnelApi.stopShareTunnel(),
};

export interface ShareTunnelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The plan to deep-link to, by id. With none, the dialog shares the tunnel root. */
  planId?: string;
  /** V1's `isReview`: `true` links into Review, `false` into Plans. */
  isReview?: boolean;
  /** Injected in tests. */
  api?: ShareTunnelApi;
}

/**
 * The connected half of `ShareTunnelDialog`.
 *
 * Three things live here because the library cannot reach them: the tunnel commands over the Tauri
 * bridge, the toast a completed action announces, and opening the share link in the system browser.
 * The dialog itself owns the polling and every visible state.
 */
export function ShareTunnelDialog({
  isOpen,
  onClose,
  planId,
  isReview,
  api = shareTunnelApi,
}: ShareTunnelDialogProps) {
  return (
    <ShareTunnelDialogView
      isOpen={isOpen}
      onClose={onClose}
      planId={planId}
      isReview={isReview}
      api={api}
      onNotify={(title, message) => notificationsStore.notifySuccess(title, message)}
      onOpenUrl={(url) => void openUrl(url)}
      // The daemon's error envelope is the app's to read: `describeBridgeError` unwraps it, and the
      // code distinguishes `TUNNEL_PRECONDITION`, which already reads as a complete sentence.
      describeError={describeBridgeError}
      errorCode={bridgeErrorCode}
    />
  );
}
