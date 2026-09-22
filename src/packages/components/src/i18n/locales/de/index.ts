/**
 * The German catalogs, one export per namespace. `../../register.ts` loads this module on demand,
 * the first time the language is chosen, so it is a chunk of its own rather than part of every
 * page.
 *
 * A translator only fills in the JSON files next to it: a key a file leaves out renders in English.
 */
export { default as uiCommon } from "./uiCommon.json";
export { default as uiDialogs } from "./uiDialogs.json";
export { default as uiPlanWorkspace } from "./uiPlanWorkspace.json";
export { default as uiShell } from "./uiShell.json";
export { default as uiVault } from "./uiVault.json";
