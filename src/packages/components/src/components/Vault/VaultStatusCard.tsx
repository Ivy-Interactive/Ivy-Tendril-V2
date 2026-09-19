import React from "react";
import { ExternalLink, Unlink } from "lucide-react";
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
  return status.name || "Team Vault";
}

/** "N behind" outranks "N ahead": what the vault has that you do not is the actionable half. */
export function formatVaultSync(status: VaultStatus): string {
  if (status.commitsBehind > 0) return `${status.commitsBehind} behind`;
  if (status.commitsAhead > 0) return `${status.commitsAhead} ahead`;
  return "In sync";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `MMM d, yyyy HH:mm UTC`, the format `VaultSetupView.cs` prints `LastSyncedAt` in. The month names
 * are spelled out here rather than left to `toLocaleString`, so the label does not drift with the
 * machine's locale.
 */
function formatLastSynced(lastSyncedAt?: string | null): string {
  if (!lastSyncedAt) return "Never";
  const parsed = new Date(lastSyncedAt);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() <= 1) return "Never";
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = parsed.getUTCDate();
  const month = MONTHS[parsed.getUTCMonth()];
  const time = `${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}`;
  return `${month} ${day}, ${parsed.getUTCFullYear()} ${time} UTC`;
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
  const repo = formatVaultRepo(status);
  const url = status.repoUrl || `https://github.com/${repo}`;
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
        <DetailItem label="Vault">
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
              label="Open on GitHub"
              variant="ghost"
              size="sm"
              onClick={() => onOpenUrl?.(url)}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </IconButton>
          </span>
        </DetailItem>
        <DetailItem label="Branch">
          <span className="font-mono">{status.currentBranch || "main"}</span>
        </DetailItem>
        <DetailItem label="Status">
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
            {status.commitsBehind > 0 || status.commitsAhead > 0 ? syncText : `✓ ${syncText}`}
          </span>
        </DetailItem>
        <DetailItem label="Last Synced">
          <span className="text-muted-foreground">{formatLastSynced(status.lastSyncedAt)}</span>
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
          Always in sync
        </label>
        <GatedActionButton
          gate={effectiveGate}
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={onDisconnect}
        >
          <Unlink className="mr-1.5 size-3.5" aria-hidden="true" />
          Disconnect Vault
        </GatedActionButton>
      </div>
    </div>
  );
};
