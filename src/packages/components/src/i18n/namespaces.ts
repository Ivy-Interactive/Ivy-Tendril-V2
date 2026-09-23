/**
 * The namespaces this package's own strings live in, one JSON file each under
 * `locales/<language>/`. `ui`-prefixed so they can never collide with one of the app's.
 *
 * Its own module, apart from the catalogs, because it must not import the JSON: the public type
 * declarations reach this list, and the declaration bundler cannot follow a JSON import.
 */
export const COMPONENT_NAMESPACES = [
  "uiCommon",
  "uiDialogs",
  "uiPlanWorkspace",
  "uiShell",
  "uiVault",
  "uiJobs",
  "uiReview",
  "uiSettings",
  "uiPanels",
] as const;

export type ComponentNamespace = (typeof COMPONENT_NAMESPACES)[number];
