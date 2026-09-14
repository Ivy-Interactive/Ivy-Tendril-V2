/**
 * Readiness gating for the vault actions — the pure port of the original app's
 * `UsePreflightCheck` hook: check what an action needs *before* offering it, and say why when it is
 * not offered, rather than letting the click fail against GitHub.
 */

export type VaultGateRequirement = "github" | "vault";

export interface VaultGateInput {
  /** Whether a GitHub identity is available (the account list came back non-empty). */
  hasGitHubAuth: boolean;
  /** Whether at least one configured vault exists. */
  hasVault: boolean;
  /** Whether a vault request is already in flight. */
  isBusy?: boolean;
  requires: VaultGateRequirement[];
}

export interface VaultGate {
  disabled: boolean;
  reason?: string;
}

/**
 * The gate reasons, verbatim: they are the tooltip a user reads on a control that will not click, so
 * they are asserted on rather than reworded per call site.
 */
export const VAULT_GATE_REASONS = {
  github: "Sign in to GitHub to create or connect a vault",
  vault: "Connect a vault first",
  busy: "Action already in progress",
} as const;

/**
 * Requirements are checked before business: a missing prerequisite outranks "already in progress",
 * because it is the thing the user has to go and fix.
 */
export function computeVaultGate(input: VaultGateInput): VaultGate {
  const { hasGitHubAuth, hasVault, isBusy = false, requires } = input;

  if (requires.includes("github") && !hasGitHubAuth) {
    return { disabled: true, reason: VAULT_GATE_REASONS.github };
  }

  if (requires.includes("vault") && !hasVault) {
    return { disabled: true, reason: VAULT_GATE_REASONS.vault };
  }

  if (isBusy) {
    return { disabled: true, reason: VAULT_GATE_REASONS.busy };
  }

  return { disabled: false };
}
