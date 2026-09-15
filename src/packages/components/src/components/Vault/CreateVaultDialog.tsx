import React from "react";
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

/** `octocat (User)` — the login is what the API needs, the type is what disambiguates it. */
export function formatAccountOption(account: GitHubAccountOption): string {
  return `${account.login} (${account.type})`;
}

export const CreateVaultDialog: React.FC<CreateVaultDialogProps> = ({
  open,
  onClose,
  accounts,
  onSubmit,
  error,
  isBusy = false,
}) => {
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
      title="Create Team Vault on GitHub"
      description="Create a private GitHub repository to share Tendril project configs, custom skills, and MCP servers with your team."
      testId="create-vault-dialog"
      error={error}
      submitLabel="Create Vault"
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
        <Label htmlFor="create-vault-name">Repository Name</Label>
        <Input
          id="create-vault-name"
          value={name}
          placeholder="Tendril-Vault"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="create-vault-owner">Owner / Organization</Label>
        {accounts.length > 0 ? (
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger id="create-vault-owner" aria-label="Owner / Organization">
              <SelectValue placeholder="Select owner" />
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
            placeholder="e.g. username or organization"
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
        Private Repository
      </label>
    </VaultDialogShell>
  );
};
