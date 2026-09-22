import { bindNamespace, type NamespaceTFunction } from "./bindings";
import english from "./locales/en/uiCommon.json";

/**
 * The `uiCommon` namespace: UI primitives, renderers and the other shared components, and the
 * strings every other namespace may reference as `uiCommon:…`. Everything a component needs to
 * translate and format comes from its namespace's module - never from
 * `@ivy-interactive/components/*`, which inside this package is the built copy, with a store of its
 * own:
 *
 * ```tsx
 * import { useFormatters, useTranslation } from "@/i18n/uiCommon";
 *
 * const { t } = useTranslation("uiCommon");
 * const format = useFormatters();
 * ```
 */
export const { i18n, useTranslation, Trans } = bindNamespace("uiCommon", english);

/** This namespace's `t`, for a helper that is handed one: `function columns(t: TFunction)`. */
export type TFunction = NamespaceTFunction<"uiCommon">;

export { useFormatters, useLocale } from "./react";
export * from "./format";
