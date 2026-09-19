import type { VerificationStatus } from "../types/api";

/**
 * `Constants.VerificationStatusBadgeVariants` (V1 `src/Ivy.Tendril/Constants.cs`): Pass is Success,
 * Fail is Destructive, Pending and Skipped are Outline. Same mapping on the review page and the
 * plan page's verification rows, so one outcome never has two looks.
 */
export const VERIFICATION_BADGE_CLASS: Record<VerificationStatus, string> = {
  Pass: "border-success/40 bg-success/10 text-success",
  Fail: "border-destructive/40 bg-destructive/10 text-destructive",
  Pending: "border-border text-muted-foreground",
  Skipped: "border-border text-muted-foreground",
};

/**
 * Badge classes for the two terminal outcomes only. Pending and Skipped are Outline in
 * `VERIFICATION_BADGE_CLASS` and carry no badge at all where this narrower map is used.
 */
export const TERMINAL_VERIFICATION_CLASS: Record<"Pass" | "Fail", string> = {
  Pass: VERIFICATION_BADGE_CLASS.Pass,
  Fail: VERIFICATION_BADGE_CLASS.Fail,
};

/** The same outcomes as a plain dot rather than a badge. */
export const VERIFICATION_DOT_CLASS: Record<VerificationStatus, string> = {
  Pass: "bg-success",
  Fail: "bg-destructive",
  Pending: "bg-muted-foreground/50",
  Skipped: "bg-muted-foreground/50",
};
