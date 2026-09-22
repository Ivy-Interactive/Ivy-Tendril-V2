import React from "react";
import { ExternalLink, Unlink } from "lucide-react";
import { i18n, useFormatters, useTranslation, type TFunction } from "@/i18n/uiVault";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { DetailItem, Details } from "../ui/detail";
import { IconButton } from "../ui/IconButton";
import { GatedActionButton } from "./GatedActionButton";
import { computeVaultGate, type VaultGate } from "./gate";
import type { VaultStatus } from "./types";

export interface VaultStatusCardProps {
  status: VaultStatus;
  onDisconnect: () => void;
  onAlwaysUpToDateChange: (value: boolean) => void;
  /** Opens the target in the system browser; the app supplies it, the component never navigates. */
  onOpenUrl?: (url: string) => void;
  isBusy?: boolean;
  gate?: VaultGate;
}

/** `https://github.com/acme/Tendril-Vault.git` reads as `acme/Tendril-Vault` in the UI. */
export function formatVaultRepo(status: VaultStatus): string {
  if (status.repoUrl) {
    return status.repoUrl.replace("https://github.com/", "").replace(/\.git$/, "");
  }
  return status.name || i18n.t("uiVault:statusCard.fallbackName");
}

/** "N behind" outranks "N ahead": what the vault has that you do not is the actionable half. */
export function formatVaultSync(status: VaultStatus): string {
  if (status.commitsBehind > 0) {
    return i18n.t("uiVault:statusCard.sync.behind", { count: status.commitsBehind });
  }
  if (status.commitsAhead > 0) {
    return i18n.t("uiVault:statusCard.sync.ahead", { count: status.commitsAhead });
  }
  return i18n.t("uiVault:statusCard.sync.inSync");
}

/*
 * The date and the time of day of `LastSyncedAt`, both in UTC. In English they read
 * `MMM d, yyyy` and `HH:mm`, the format `VaultSetupView.cs` prints it in (`Jan 2, 2026 03:04 UTC`);
 * other languages get their own month names and order, never the machine's locale.
 */
const LAST_SYNCED_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
};
const LAST_SYNCED_TIME: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
};

function formatLastSynced(
  t: TFunction,
  format: ReturnType<typeof useFormatters>,
  lastSyncedAt?: string | null,
): string {
  if (!lastSyncedAt) return t("statusCard.lastSynced.never");
  const parsed = new Date(lastSyncedAt);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() <= 1) {
    return t("statusCard.lastSynced.never");
  }
  return t("statusCard.lastSynced.value", {
    date: format.date(parsed, LAST_SYNCED_DATE),
    time: format.time(parsed, LAST_SYNCED_TIME),
  });
}

/**
 * The connected vault: the four details `VaultSetupView.cs` builds with `ToDetails()` — Vault,
 * Branch, Status, Last Synced, in that order — over the row that carries "Always in sync" and the
 * disconnect.
 *
 * Sync lives in the section toolbar, not here, because that is where the original keeps it: the
 * details row is about the vault's state and the one action that ends it.
 */
export const VaultStatusCard: React.FC<VaultStatusCardProps> = ({
  status,
  onDisconnect,
  onAlwaysUpToDateChange,
  onOpenUrl,
  isBusy = false,
  gate,
}) => {
  const { t } = useTranslation("uiVault");
  const format = useFormatters();
  const repo = formatVaultRepo(status);
  /* Built from the vault's own name, never from the translated fallback label `repo` may carry. */
  const url = status.repoUrl || `https://github.com/${status.name}`;
  const syncText = formatVaultSync(status);
  const effectiveGate =
    gate ??
    computeVaultGate({
      hasGitHubAuth: true,
      hasVault: status.isConfigured,
      isBusy,
      requires: ["vault"],
    });

  return (
    <div className="space-y-2" data-testid="vault-status-card">
      <Details>
        <DetailItem label={t("statusCard.details.vault")}>
          <span className="flex items-center justify-end gap-1">
            {/* `link` is this treatment exactly - `text-primary underline-offset-4 hover:underline`
                in `buttonVariant` - so the hand-rolled copy was one more place the shared link had
                to be kept in step by hand. `h-auto p-0` because a link inside a detail row is not a
                control-height box; the variant's own size keys all carry one. */}
            <Button
              type="button"
              variant="link"
              onClick={() => onOpenUrl?.(url)}
              className="h-auto p-0"
            >
              {repo}
            </Button>
            <IconButton
              label={t("statusCard.openOnGitHub")}
              variant="ghost"
              size="sm"
              onClick={() => onOpenUrl?.(url)}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </IconButton>
          </span>
        </DetailItem>
        <DetailItem label={t("statusCard.details.branch")}>
          {/* A branch name, not copy: `main` is what the vault checks out when it names none. */}
          <span className="font-mono">{status.currentBranch || "main"}</span>
        </DetailItem>
        <DetailItem label={t("statusCard.details.status")}>
          {/* Behind is the only state that is wrong rather than merely unpublished, so it is the
              only one tinted; ahead reads as plain foreground and in-sync as a muted tick, exactly
              as the `GitStatus` builder decides in `VaultSetupView.cs`. */}
          <span
            className={
              status.commitsBehind > 0
                ? "text-destructive"
                : status.commitsAhead > 0
                  ? "text-foreground"
                  : "text-muted-foreground"
            }
            data-testid="vault-git-status"
          >
            {status.commitsBehind > 0 || status.commitsAhead > 0
              ? syncText
              : t("statusCard.syncedStatus", { status: syncText })}
          </span>
        </DetailItem>
        <DetailItem label={t("statusCard.details.lastSynced")}>
          <span className="text-muted-foreground">
            {formatLastSynced(t, format, status.lastSyncedAt)}
          </span>
        </DetailItem>
      </Details>

      <div className="flex items-center justify-between gap-3">
        <label
          className="flex items-center gap-2 text-xs text-foreground"
          htmlFor="vault-always-in-sync"
        >
          <Checkbox
            id="vault-always-in-sync"
            checked={status.alwaysUpToDate}
            onCheckedChange={(checked) => onAlwaysUpToDateChange(checked === true)}
          />
          {t("statusCard.alwaysInSync")}
        </label>
        <GatedActionButton
          gate={effectiveGate}
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={onDisconnect}
        >
          <Unlink className="mr-1.5 size-3.5" aria-hidden="true" />
          {t("statusCard.disconnect")}
        </GatedActionButton>
      </div>
    </div>
  );
};
