// Shared strings every namespace may reference as `uiCommon:…`.
import "./uiCommon";
import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiJobs.json";

/**
 * The `uiJobs` namespace: the Jobs sheets and dialogs in `components/Sheets` and `components/Dialogs`: job output, prompt, cost, rerun, report-bug and debug-with-agent.
 *
 * ```tsx
 * import { useTranslation } from "@/i18n/uiJobs";
 *
 * const { t } = useTranslation("uiJobs");
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiJobs", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiJobs">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
