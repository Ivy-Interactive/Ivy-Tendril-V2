import React from "react";
import { i18n, useTranslation } from "@/i18n/uiVault";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { githubAccountTypeLabel } from "./CreateVaultDialog";
import { VaultDialogShell } from "./VaultDialogShell";
import type { DiscoveredVaultRepo } from "./types";

export interface ConnectVaultSubmission {
  repoUrl: string;
  /** Optional display name; empty means "name it after the repo". */
  displayName: string;
}

export interface ConnectVaultDialogProps {
  open: boolean;
  onClose: () => void;
  /** Vaults discovered on the user's GitHub account and orgs; empty hides the picker. */
  discovered: DiscoveredVaultRepo[];
  isDiscovering?: boolean;
  onSubmit: (submission: ConnectVaultSubmission) => void;
  error?: string | null;
  isBusy?: boolean;
}

/** `acme/Tendril-Vault (Organization, private)` — enough to tell two similarly named repos apart. */
export function formatDiscoveredRepo(repo: DiscoveredVaultRepo): string {
  return i18n.t("uiVault:connectDialog.repoOption", {
    fullName: repo.fullName,
    accountType: githubAccountTypeLabel(repo.accountType),
    context: repo.isPrivate ? "private" : undefined,
  });
}

export const ConnectVaultDialog: React.FC<ConnectVaultDialogProps> = ({
  open,
  onClose,
  discovered,
  isDiscovering = false,
  onSubmit,
  error,
  isBusy = false,
}) => {
  const { t } = useTranslation("uiVault");
  const [repoUrl, setRepoUrl] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [selected, setSelected] = React.useState("");

  /* Picking a detected repo fills the form in, but never overwrites a name the user chose. */
  const handleSelect = (url: string) => {
    setSelected(url);
    const matched = discovered.find((repo) => repo.repoUrl === url);
    setRepoUrl(matched?.repoUrl ?? url);
    if (matched) {
      setDisplayName((current) =>
        current.trim() === "" || discovered.some((repo) => repo.fullName === current)
          ? matched.fullName
          : current,
      );
    }
  };

  /* A typed URL wins; the picked repo is the fallback, so picking alone is enough to submit. */
  const effectiveUrl = repoUrl.trim() !== "" ? repoUrl.trim() : selected.trim();
  const submitDisabled = isBusy || effectiveUrl === "";

  return (
    <VaultDialogShell
      open={open}
      onClose={onClose}
      title={t("connectDialog.title")}
      description={t("connectDialog.description")}
      testId="connect-vault-dialog"
      error={error}
      submitLabel={t("connectDialog.submit")}
      submitDisabled={submitDisabled}
      onSubmit={() => {
        if (submitDisabled) return;
        onSubmit({ repoUrl: effectiveUrl, displayName: displayName.trim() });
      }}
    >
      {isDiscovering && (
        <p className="text-xs text-muted-foreground" data-testid="connect-vault-discovering">
          {t("connectDialog.discovering")}
        </p>
      )}

      {!isDiscovering && discovered.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="connect-vault-detected">{t("connectDialog.detected.label")}</Label>
          <Select value={selected} onValueChange={handleSelect}>
            <SelectTrigger
              id="connect-vault-detected"
              aria-label={t("connectDialog.detected.label")}
            >
              <SelectValue placeholder={t("connectDialog.detected.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {discovered.map((repo) => (
                <SelectItem key={repo.repoUrl} value={repo.repoUrl}>
                  {formatDiscoveredRepo(repo)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="connect-vault-url">{t("connectDialog.url.label")}</Label>
        <Input
          id="connect-vault-url"
          value={repoUrl}
          placeholder="https://github.com/my-org/Tendril-Vault.git"
          onChange={(event) => setRepoUrl(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="connect-vault-name">{t("connectDialog.displayName.label")}</Label>
        <Input
          id="connect-vault-name"
          value={displayName}
          placeholder={t("connectDialog.displayName.placeholder")}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
    </VaultDialogShell>
  );
};
