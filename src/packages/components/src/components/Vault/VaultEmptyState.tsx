import React from "react";
import { GitBranch, Plus } from "lucide-react";
import { useTranslation } from "@/i18n/uiVault";
import { GatedActionButton } from "./GatedActionButton";
import type { VaultGate } from "./gate";

export interface VaultEmptyStateProps {
  onCreate: () => void;
  onConnect: () => void;
  /** Both actions need a GitHub identity, so they share one gate. */
  gate?: VaultGate;
}

const OPEN: VaultGate = { disabled: false };

/**
 * What the Team Vault section shows before any vault is connected — the `notConfiguredLayout` of
 * `VaultSetupView.cs`, which is the whole section in that state: no toolbar, no details, no table.
 * `max-w-200` is its `Size.Auto().Max(Size.Units(200))`.
 */
export const VaultEmptyState: React.FC<VaultEmptyStateProps> = ({
  onCreate,
  onConnect,
  gate = OPEN,
}) => {
  const { t } = useTranslation("uiVault");
  return (
    <div className="max-w-200 space-y-3" data-testid="vault-empty-state">
      <h3 className="text-sm font-semibold text-foreground">{t("emptyState.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("emptyState.description")}</p>
      <div className="flex items-center gap-2">
        <GatedActionButton gate={gate} size="sm" onClick={onCreate}>
          <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
          {t("emptyState.create")}
        </GatedActionButton>
        <GatedActionButton gate={gate} variant="outline" size="sm" onClick={onConnect}>
          <GitBranch className="mr-1.5 size-3.5" aria-hidden="true" />
          {t("emptyState.connect")}
        </GatedActionButton>
      </div>
    </div>
  );
};
