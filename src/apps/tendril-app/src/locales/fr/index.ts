/// <reference types="vite/client" />
import type { Messages } from "@ivy-interactive/components/i18n";

/**
 * Every catalog in this directory, keyed by file path, so that `../../i18n/index.ts` can load a
 * language as one chunk: it imports this module lazily, and this module takes in each JSON file
 * eagerly. The file is the same in every locale directory, so a namespace file dropped in here is
 * picked up without touching any code.
 */
export const catalogs = import.meta.glob<Messages>("./*.json", { eager: true, import: "default" });
