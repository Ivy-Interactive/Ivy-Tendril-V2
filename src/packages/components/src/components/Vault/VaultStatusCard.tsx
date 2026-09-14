import React from "react";
import { ExternalLink, RefreshCw, Unlink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { GatedActionButton } from "./GatedActionButton";
import { computeVaultGate, type VaultGate } from "./gate";
import type { VaultStatus } from "./types";

export interface VaultStatusCardProps {
  status: VaultStatus;
  /** Every configured vault, so the card can offer a picker when there is more than one. */
  vaults: VaultStatus[];
  selectedVaultId: string;
  onSelectVault: (vaultId: string) => void;
  onSync: () => void;
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

function formatLastSynced(lastSyncedAt?: string | null): string {
  if (!lastSyncedAt) return "Never";
  const parsed = new Date(lastSyncedAt);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() <= 1) return "Never";
  const date = parsed.toISOString().slice(0, 10);
  const time = parsed.toISOString().slice(11, 16);
  return `${date} ${time} UTC`;
}

/** The label a vault is picked by: its repo name, falling back to its id. */
function vaultLabel(vault: VaultStatus): string {
  const display = formatVaultRepo(vault);
  return display || vault.id;
}

export const VaultStatusCard: React.FC<VaultStatusCardProps> = ({
  status,
  vaults,
  selectedVaultId,
  onSelectVault,
  onSync,
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
    <div
      className="rounded-xl border border-border bg-card/60 p-4 space-y-4"
      data-testid="vault-status-card"
    >
      {vaults.length > 1 && (
        <Select value={selectedVaultId} onValueChange={onSelectVault}>
          <SelectTrigger aria-label="Active vault" className="w-fit min-w-56">
            <SelectValue placeholder="Select vault" />
          </SelectTrigger>
          <SelectContent>
            {vaults.map((vault) => (
              <SelectItem key={vault.id} value={vault.id}>
                {vaultLabel(vault)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Vault</dt>
          <dd className="flex items-center gap-1 font-medium text-foreground">
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => onOpenUrl?.(url)}
            >
              {repo}
            </button>
            <button
              type="button"
              aria-label="Open on GitHub"
              title="Open on GitHub"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onOpenUrl?.(url)}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </button>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="font-mono text-foreground">{status.currentBranch || "main"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd
            className={status.commitsBehind > 0 ? "text-destructive" : "text-muted-foreground"}
            data-testid="vault-git-status"
          >
            {syncText}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last Synced</dt>
          <dd className="text-muted-foreground">{formatLastSynced(status.lastSyncedAt)}</dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <label className="flex items-center gap-2 text-xs text-foreground">
          <Switch
            checked={status.alwaysUpToDate}
            onCheckedChange={onAlwaysUpToDateChange}
            aria-label="Always in sync"
          />
          Always in sync
        </label>
        <div className="flex items-center gap-2">
          <GatedActionButton gate={effectiveGate} variant="outline" size="sm" onClick={onSync}>
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            Sync
          </GatedActionButton>
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
    </div>
  );
};
