import React from "react";
import { GitBranch, Plus } from "lucide-react";
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
}) => (
  <div className="max-w-200 space-y-3" data-testid="vault-empty-state">
    <h3 className="text-sm font-semibold text-foreground">Team Configuration Vault</h3>
    <p className="text-xs text-muted-foreground">
      Share and synchronize Tendril projects, custom skills, MCP servers, and security rules across
      your team via a versioned Git repository.
    </p>
    <div className="flex items-center gap-2">
      <GatedActionButton gate={gate} size="sm" onClick={onCreate}>
        <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
        Create GitHub Vault
      </GatedActionButton>
      <GatedActionButton gate={gate} variant="outline" size="sm" onClick={onConnect}>
        <GitBranch className="mr-1.5 size-3.5" aria-hidden="true" />
        Connect Existing Git Vault
      </GatedActionButton>
    </div>
  </div>
);
