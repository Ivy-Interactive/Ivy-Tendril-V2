// Shared strings every namespace may reference as `uiCommon:…`.
import "./uiCommon";
import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiDialogs.json";

/**
 * The `uiDialogs` namespace: the dialogs in `components/Dialogs`. Everything a component needs to
 * translate and format comes from here:
 *
 * ```tsx
 * import { useTranslation } from "@/i18n/uiDialogs";
 *
 * const { t } = useTranslation("uiDialogs");
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiDialogs", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiDialogs">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
