import { useEffect, useState } from "react";
import { copyToClipboard } from "@ivy-interactive/components";
import { shareUrlForPlan } from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { tunnelApi } from "../../api/tunnelApi";
import { notificationsStore } from "../../state/notificationsStore";
import { i18n } from "../../i18n";

/**
 * V1's `BetaHelper.IsBeta(tendrilArgs, config)`, from `config.yaml`'s `beta` - the flag V1 gates the
 * plan and review pages' Share action on (`DraftActions.cs:144`, `ReviewActions.cs:88`).
 *
 * `beta` is not on `TendrilConfigDto`, so it is read out of the untouched `raw` config, as the
 * Settings page reads it. An unreadable config is "not beta": the action stays hidden rather than
 * appearing for a flag nobody set.
 */
export function useBetaFlag(): boolean {
  const [beta, setBeta] = useState(false);
  useEffect(() => {
    let cancelled = false;
    bridge
      .getConfig()
      .then((config) => {
        if (!cancelled) setBeta(config?.raw?.beta === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return beta;
}

const t = i18n.getFixedT(null, "plans");

/**
 * V1's `SharePlan` (`DraftActions.cs:56`, `ReviewActions.cs:50`): with a share tunnel already up, the
 * plan's link goes straight to the clipboard ("Plan share link copied to clipboard"); otherwise the
 * Share Tunnel dialog opens so one can be started. `isReview` picks the page the link lands on, as
 * V1's `GetShareUrlForPlan(folderName, isReview)` does.
 */
export async function sharePlan(
  planId: string,
  isReview: boolean,
  openDialog: () => void,
): Promise<void> {
  try {
    const snapshot = await tunnelApi.getShareTunnel();
    if (snapshot.status === "connected" && snapshot.url) {
      await copyToClipboard(shareUrlForPlan(snapshot, planId, isReview));
      notificationsStore.notifySuccess(t("share.linkCopiedTitle"), t("share.linkCopied"));
      return;
    }
  } catch {
    // No answer about the tunnel is no tunnel: the dialog is where one is started and where the
    // daemon's own error is shown.
  }
  openDialog();
}
