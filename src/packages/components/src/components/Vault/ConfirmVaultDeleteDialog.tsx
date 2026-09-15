import React from "react";
import { GitPullRequest } from "lucide-react";
import { Callout } from "../ui/callout";
import { VaultDialogShell } from "./VaultDialogShell";

export interface ConfirmVaultDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  onConfirm: () => void;
  error?: string | null;
  isBusy?: boolean;
}

/**
 * The confirm for removing a project from the vault. Deletion is not immediate — it opens a PR — but
 * it is still destructive for the team, so it says exactly what disappears before asking.
 */
export const ConfirmVaultDeleteDialog: React.FC<ConfirmVaultDeleteDialogProps> = ({
  open,
  onClose,
  projectName,
  onConfirm,
  error,
  isBusy = false,
}) => (
  <VaultDialogShell
    open={open}
    onClose={onClose}
    title={`Delete '${projectName}' from Vault?`}
    testId="confirm-vault-delete-dialog"
    error={error}
    submitLabel="Create Deletion PR"
    submitVariant="destructive"
    submitIcon={<GitPullRequest className="mr-1.5 size-3.5" aria-hidden="true" />}
    submitDisabled={isBusy}
    onSubmit={onConfirm}
  >
    <Callout.Error>
      This will remove project &apos;{projectName}&apos; and all its associated manifests, skills,
      MCP configs, and memories from the vault repository.
    </Callout.Error>
    <p className="text-xs text-muted-foreground">
      A new branch and pull request will be opened against the vault repository to perform this
      deletion.
    </p>
  </VaultDialogShell>
);
