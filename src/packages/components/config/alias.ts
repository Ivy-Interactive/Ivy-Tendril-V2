import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the library source root, resolved from this file's own location. */
export const srcDir: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

/** The single `"@" -> src` mapping shared by the vite, vitest and Storybook configs. */
export const aliasEntries: Readonly<Record<string, string>> = Object.freeze({ "@": srcDir });
