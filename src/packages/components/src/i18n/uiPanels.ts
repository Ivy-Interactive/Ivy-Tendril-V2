// Shared strings every namespace may reference as `uiCommon:…`.
import "./uiCommon";
import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiPanels.json";

/**
 * The `uiPanels` namespace: the chat, inbox, pull-request, dashboard and shell sheets and dialogs.
 *
 * ```tsx
 * import { useTranslation } from "@/i18n/uiPanels";
 *
 * const { t } = useTranslation("uiPanels");
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiPanels", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiPanels">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
