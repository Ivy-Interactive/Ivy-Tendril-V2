import type { VerificationStatus } from "../types/api";

/**
 * `Constants.VerificationStatusBadgeVariants` (V1 `src/Ivy.Tendril/Constants.cs`) as shared `Badge`
 * variants: Pass is Success, Fail is Destructive, Pending and Skipped are Outline. Same mapping on
 * the review page and the plan page's verification rows, so one outcome never has two looks.
 *
 * This was a map of class strings until `Badge` grew `success`/`destructive`/`outline` variants.
 * Both verification surfaces hand-rolled a bare `<span>` from it, which is why the label sat oddly:
 * a span is not `inline-flex items-center`, so the text aligned on its own baseline instead of being
 * centred in the chip, and it drew itself `font-medium` with `rounded` and one-off `/40` and `/10`
 * tints while every other badge in the app is `font-normal`, `rounded-selector` and tinted from
 * `--badge-tint-*`. Naming the variant keeps one definition of what a badge looks like.
 */
export type VerificationBadgeVariant = "success" | "destructive" | "outline";

export const VERIFICATION_BADGE_VARIANT: Record<VerificationStatus, VerificationBadgeVariant> = {
  Pass: "success",
  Fail: "destructive",
  Pending: "outline",
  Skipped: "outline",
};

/** The same outcomes as a plain dot rather than a badge. */
export const VERIFICATION_DOT_CLASS: Record<VerificationStatus, string> = {
  Pass: "bg-success",
  Fail: "bg-destructive",
  Pending: "bg-muted-foreground/50",
  Skipped: "bg-muted-foreground/50",
};
