import React from "react";
import { Alert, AlertDescription } from "../ui/alert";
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
    submitDisabled={isBusy}
    onSubmit={onConfirm}
  >
    <Alert variant="destructive">
      <AlertDescription>
        This will remove project &apos;{projectName}&apos; and all its associated manifests, skills,
        MCP configs, and memories from the vault repository.
      </AlertDescription>
    </Alert>
    <p className="text-xs text-muted-foreground">
      A new branch and pull request will be opened against the vault repository to perform this
      deletion.
    </p>
  </VaultDialogShell>
);
