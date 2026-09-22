// Shared strings every namespace may reference as `uiCommon:…`.
import "./uiCommon";
import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiShell.json";

/**
 * The `uiShell` namespace: the Tendril shell and its sidebar rows, the agent viewer, the dashboard
 * widgets, the process viewer, the web viewer, the terminal and the content input. Everything a
 * component needs to translate and format comes from here:
 *
 * ```tsx
 * import { useTranslation } from "@/i18n/uiShell";
 *
 * const { t } = useTranslation("uiShell");
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiShell", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiShell">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
