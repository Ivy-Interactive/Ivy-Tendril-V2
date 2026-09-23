/**
 * The English catalogs, one export per namespace. English is the source language: every key is
 * added here first, the key types are derived from these files (`../../bindings.ts`), and every
 * other locale falls back to them. At runtime each namespace's module (`../../uiDialogs.ts`, …)
 * imports its own file statically, so a component renders English with no setup.
 */
export { default as uiCommon } from "./uiCommon.json";
export { default as uiDialogs } from "./uiDialogs.json";
export { default as uiPlanWorkspace } from "./uiPlanWorkspace.json";
export { default as uiShell } from "./uiShell.json";
export { default as uiVault } from "./uiVault.json";
export { default as uiJobs } from "./uiJobs.json";
export { default as uiPanels } from "./uiPanels.json";
export { default as uiReview } from "./uiReview.json";
export { default as uiSettings } from "./uiSettings.json";
