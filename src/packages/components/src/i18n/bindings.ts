import "./register";
import type { ComponentNamespace } from "./namespaces";
import { createTranslation } from "./react";
import type { ComponentResources } from "./resources";
import { i18nStore, type Messages } from "./runtime";
import type { TFunction, Translation } from "./types";

/**
 * What the namespace modules (`./uiDialogs.ts`, …) are built from. Components never import this
 * module: they import the module named after their namespace, which calls {@link bindNamespace}.
 *
 * A namespace module's `useTranslation`, `Trans` and `i18n` are typed for that namespace and for
 * `uiCommon`, and for nothing else, because those are the two catalogs importing it guarantees are
 * registered. A component that reached for a third - `uiDialogs:` keys from the shell - would render
 * raw keys whenever that namespace's module had not loaded yet (the dialogs are a lazy chunk), so
 * the type checker refuses it rather than leaving it to chunk order.
 */

/** The catalogs a namespace module can reach: its own, and the shared `uiCommon`. */
export type NamespaceResources<N extends ComponentNamespace> = Pick<
  ComponentResources,
  N | "uiCommon"
>;

/** A `t` bound to namespace `N`: its own keys bare, `uiCommon`'s qualified (`"uiCommon:…"`). */
export type NamespaceTFunction<N extends ComponentNamespace> = TFunction<NamespaceResources<N>, N>;

/**
 * Registers a namespace's English, as its module loads, and returns that module's binding. So a
 * component renders English with no setup - in the docs site, a test, a Storybook story - and the
 * English of a lazily loaded component travels in that component's chunk rather than in every page.
 */
export function bindNamespace<N extends ComponentNamespace>(
  namespace: N,
  english: Messages,
): Translation<NamespaceResources<N>> {
  i18nStore.addResourceBundle("en", namespace, english);
  return createTranslation<NamespaceResources<N>>();
}
