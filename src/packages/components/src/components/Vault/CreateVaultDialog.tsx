import React from "react";
import { i18n, useTranslation } from "@/i18n/uiVault";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { VaultDialogShell } from "./VaultDialogShell";
import type { GitHubAccountOption } from "./types";

export interface CreateVaultSubmission {
  name: string;
  isPrivate: boolean;
  /** The chosen owner, or undefined for "my account" when nothing was picked or typed. */
  owner?: string;
}

export interface CreateVaultDialogProps {
  open: boolean;
  onClose: () => void;
  accounts: GitHubAccountOption[];
  onSubmit: (submission: CreateVaultSubmission) => void;
  error?: string | null;
  isBusy?: boolean;
}

/** The labels of the account types GitHub reports; a type it adds later is shown as it comes. */
const ACCOUNT_TYPE_KEYS = new Map<string, Parameters<typeof i18n.t>[0]>([
  ["User", "uiVault:githubAccountTypes.user"],
  ["Organization", "uiVault:githubAccountTypes.organization"],
]);

/**
 * `User` / `Organization`, in the current language. The raw type is what GitHub sends; only the
 * label shown for it is translated.
 */
export function githubAccountTypeLabel(type: string): string {
  const key = ACCOUNT_TYPE_KEYS.get(type);
  return key ? i18n.t(key) : type;
}

/** `octocat (User)` — the login is what the API needs, the type is what disambiguates it. */
export function formatAccountOption(account: GitHubAccountOption): string {
  return i18n.t("uiVault:createDialog.accountOption", {
    login: account.login,
    type: githubAccountTypeLabel(account.type),
  });
}

export const CreateVaultDialog: React.FC<CreateVaultDialogProps> = ({
  open,
  onClose,
  accounts,
  onSubmit,
  error,
  isBusy = false,
}) => {
  const { t } = useTranslation("uiVault");
  /* The default repository name, not copy: it is what the repo is created as on GitHub. */
  const [name, setName] = React.useState("Tendril-Vault");
  const [owner, setOwner] = React.useState("");
  const [isPrivate, setIsPrivate] = React.useState(true);

  /* The first account is the sensible default owner, but only until the user picks one. */
  React.useEffect(() => {
    setOwner((current) => (current === "" && accounts.length > 0 ? accounts[0].login : current));
  }, [accounts]);

  const trimmedName = name.trim();
  const submitDisabled = isBusy || trimmedName === "";

  return (
    <VaultDialogShell
      open={open}
      onClose={onClose}
      title={t("createDialog.title")}
      description={t("createDialog.description")}
      testId="create-vault-dialog"
      error={error}
      submitLabel={t("createDialog.submit")}
      submitDisabled={submitDisabled}
      onSubmit={() => {
        if (submitDisabled) return;
        const trimmedOwner = owner.trim();
        onSubmit({
          name: trimmedName,
          isPrivate,
          owner: trimmedOwner === "" ? undefined : trimmedOwner,
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="create-vault-name">{t("createDialog.name.label")}</Label>
        <Input
          id="create-vault-name"
          value={name}
          placeholder="Tendril-Vault"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="create-vault-owner">{t("createDialog.owner.label")}</Label>
        {accounts.length > 0 ? (
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger id="create-vault-owner" aria-label={t("createDialog.owner.label")}>
              <SelectValue placeholder={t("createDialog.owner.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.login} value={account.login}>
                  {formatAccountOption(account)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          /* No accounts came back — the owner is still needed, so let it be typed. */
          <Input
            id="create-vault-owner"
            value={owner}
            placeholder={t("createDialog.owner.inputPlaceholder")}
            onChange={(event) => setOwner(event.target.value)}
          />
        )}
      </div>

      {/* `isPrivate.ToBoolInput("Private Repository")` — `BoolInputVariant.Checkbox` is the default
          `ToBoolInput` variant, so every vault bool reads as a checkbox rather than a switch. */}
      <label
        className="flex items-center gap-2 text-xs text-foreground"
        htmlFor="create-vault-private"
      >
        <Checkbox
          id="create-vault-private"
          checked={isPrivate}
          onCheckedChange={(checked) => setIsPrivate(checked === true)}
        />
        {t("createDialog.private")}
      </label>
    </VaultDialogShell>
  );
};
