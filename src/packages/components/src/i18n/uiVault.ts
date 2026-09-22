// Shared strings every namespace may reference as `uiCommon:…`.
import "./uiCommon";
import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiVault.json";

/**
 * The `uiVault` namespace: the Team Vault components in `components/Vault`. Everything a component
 * needs to translate and format comes from here:
 *
 * ```tsx
 * import { useTranslation } from "@/i18n/uiVault";
 *
 * const { t } = useTranslation("uiVault");
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiVault", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiVault">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
