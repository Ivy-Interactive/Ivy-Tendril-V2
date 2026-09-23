// Shared strings every namespace may reference as `uiCommon:…`.
import "./uiCommon";
import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiSettings.json";

/**
 * The `uiSettings` namespace: the Settings sheets and dialogs: agent test, project memory, repo-asset import and vault themes.
 *
 * ```tsx
 * import { useTranslation } from "@/i18n/uiSettings";
 *
 * const { t } = useTranslation("uiSettings");
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiSettings", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiSettings">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
