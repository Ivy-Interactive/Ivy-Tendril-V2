import React from "react";
import { GitPullRequest } from "lucide-react";
import { useTranslation } from "@/i18n/uiVault";
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
}) => {
  const { t } = useTranslation("uiVault");
  return (
    <VaultDialogShell
      open={open}
      onClose={onClose}
      title={t("confirmDelete.title", { projectName })}
      testId="confirm-vault-delete-dialog"
      error={error}
      submitLabel={t("confirmDelete.submit")}
      submitVariant="destructive"
      submitIcon={<GitPullRequest className="mr-1.5 size-3.5" aria-hidden="true" />}
      submitDisabled={isBusy}
      onSubmit={onConfirm}
    >
      <Callout.Error>{t("confirmDelete.warning", { projectName })}</Callout.Error>
      <p className="text-xs text-muted-foreground">{t("confirmDelete.note")}</p>
    </VaultDialogShell>
  );
};
