// Shared strings every namespace may reference as `uiCommon:…`.
import "./uiCommon";
import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiPlanWorkspace.json";

/**
 * The `uiPlanWorkspace` namespace: PlanWorkspace, PlanMarkdown, PlanDiffView, PlanGitView,
 * SortableVerificationList and TendrilQuestions. Everything a component needs to translate and
 * format comes from here:
 *
 * ```tsx
 * import { useTranslation } from "@/i18n/uiPlanWorkspace";
 *
 * const { t } = useTranslation("uiPlanWorkspace");
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiPlanWorkspace", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiPlanWorkspace">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
