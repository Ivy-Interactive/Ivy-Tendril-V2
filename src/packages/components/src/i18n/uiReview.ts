// Shared strings every namespace may reference as `uiCommon:…`.
import "./uiCommon";
import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiReview.json";

/**
 * The `uiReview` namespace: the plan and review sheets and dialogs: commit detail, file, verification report, artifact and share-tunnel surfaces.
 *
 * ```tsx
 * import { useTranslation } from "@/i18n/uiReview";
 *
 * const { t } = useTranslation("uiReview");
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiReview", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiReview">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
