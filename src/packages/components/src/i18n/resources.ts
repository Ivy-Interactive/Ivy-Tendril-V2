import * as english from "./locales/en/index";
import type { ComponentNamespace } from "./namespaces";
import type { Messages } from "./runtime";

/**
 * The type every component key is checked against: this package's English catalogs, by namespace.
 * Imported with `import type` only, so none of this JSON is ever bundled from here - each
 * namespace's module (`./uiDialogs.ts`, …) imports its own file for the runtime.
 *
 * Why a value, rather than `typeof import("./locales/en/uiDialogs.json")`: the published type
 * declarations are written by tsgo, which emits no declaration for a JSON module, so a declaration
 * that *refers* to one fails the package build ("tsgo did not generate dts file for ….json"). That
 * reaches further than the public API - any exported signature that names a `t` or a key, in any
 * module a published entry reaches, would do it. The type of a value is inferred instead, and an
 * inferred type is written out in full: the declaration of `catalogs` spells out the catalogs' key
 * structure itself and refers to no JSON file, so a `t` can appear in any signature.
 * `tests/i18n-types.test.tsx` holds this module to that.
 */
const catalogs = { ...english } satisfies Record<ComponentNamespace, Messages>;

export type ComponentResources = typeof catalogs;
