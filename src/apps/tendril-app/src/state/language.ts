import {
  LOCALES,
  findLocale,
  matchLocale,
  type SiteLocale,
} from "@ivy-interactive/components/i18n";
import { bridge } from "../api/bridge";
import { i18n } from "../i18n";
import type { TendrilConfig } from "../types/api";

/**
 * The UI language: which one `config.yaml` asks for, what that resolves to on this machine, and
 * applying it. The same shape as `state/appearance.ts`, and kept out of `AppearanceSettings` because
 * that object is compared whole in tests that predate it.
 *
 * `config.yaml`'s top-level `language` holds a locale code (`de`, `pt`), or `system` - or nothing -
 * to follow the operating system. The daemon does not model the key; it round-trips through
 * `TendrilSettings`' catch-all, so `tendril config set language de` works from the CLI too.
 *
 * Start-up happens in two steps, like the theme's. `main.tsx` renders in the language the last
 * session applied, read synchronously from a `localStorage` mirror ({@link startupLanguage}), so the
 * first paint is already right. Then `App`'s mount effect runs {@link initLanguage}, which reads
 * `config.yaml` - the authority - and applies it; a config change (the Appearance pane, the CLI, the
 * raw editor) runs {@link refreshLanguage} through `api/changes.ts`. So does every (re)connection to
 * the daemon: the start-up read fails when the daemon is not up yet, and a change made while it was
 * out of reach raised no event this session heard.
 */

/** A locale code, or `system`: follow the operating system's languages. */
export type LanguagePreference = SiteLocale | "system";

/** The first-paint mirror, beside `ThemeProvider`'s `tendril-theme`. */
export const LANGUAGE_STORAGE_KEY = "tendril-language";

/**
 * `config.yaml`'s value, validated. The file is edited by hand, so a BCP 47 tag naming a locale counts
 * too (`pt-BR`, `de-AT`). Anything else - `system`, a typo, a language Tendril does not ship - means
 * `system`, as an unknown `themeMode` does, so a mistake leaves the app following the OS rather than
 * stuck in English.
 */
export const asLanguagePreference = (value: unknown): LanguagePreference =>
  (typeof value === "string" && findLocale(value)) || "system";

export const readLanguagePreference = (config: TendrilConfig | null): LanguagePreference =>
  asLanguagePreference(config?.raw?.language);

/** The operating system's languages, most preferred first, as the webview reports them. */
export function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

/** The language a preference means here: its own, or the first of the OS's Tendril ships. */
export const resolveLanguage = (
  preference: LanguagePreference,
  languages: readonly string[] = systemLanguages(),
): SiteLocale => (preference === "system" ? matchLocale(languages) : preference);

/** The mirror. Storage can be missing or locked (a sandboxed webview), which reads as `system`. */
export function readStoredLanguagePreference(): LanguagePreference {
  try {
    return asLanguagePreference(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/**
 * Written only when a preference is *applied* - chosen in Appearance, or read from `config.yaml` -
 * never at start-up, and only when it changes. `system` is the absence of the key.
 */
function storeLanguagePreference(preference: LanguagePreference): void {
  try {
    if (preference === "system") {
      localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } else if (localStorage.getItem(LANGUAGE_STORAGE_KEY) !== preference) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
    }
  } catch {
    // The mirror only saves a flash of the previous language at the next start; losing it is fine.
  }
}

/** What `main.tsx` renders in before `config.yaml` has been read. */
export const startupLanguage = (): SiteLocale => resolveLanguage(readStoredLanguagePreference());

/**
 * `<html lang dir>` for the current language. Screen readers pick their voice from `lang`, and the
 * webview picks CJK and Devanagari glyphs by it.
 */
export function syncDocumentLanguage(): void {
  const { hreflang, dir } = LOCALES[i18n.language];
  document.documentElement.lang = hreflang;
  document.documentElement.dir = dir;
}

/** Switches the UI to `language`: loads its catalogs, re-renders every string, updates `<html>`. */
export async function applyLanguage(language: SiteLocale): Promise<void> {
  await i18n.changeLanguage(language);
  syncDocumentLanguage();
}

/**
 * Every apply takes a ticket, so that one a later apply overtook while its catalogs were still
 * loading is not remembered as the preference. (The runtime already keeps it from switching: the
 * latest `changeLanguage` wins.)
 */
let latestApply = 0;

/**
 * Applies a preference and remembers it for the next start. Resolves to the language applied, or to
 * `null` when a later apply overtook this one while its catalogs loaded: the later one decides, and
 * nothing is remembered for this one - not even that it failed. Rejects, changing nothing, if the
 * language's catalogs cannot be loaded.
 */
export async function applyLanguagePreference(
  preference: LanguagePreference,
): Promise<SiteLocale | null> {
  const ticket = ++latestApply;
  const language = resolveLanguage(preference);
  try {
    await applyLanguage(language);
  } catch (error) {
    if (ticket !== latestApply) return null;
    throw error;
  }
  if (ticket !== latestApply) return null;
  storeLanguagePreference(preference);
  return language;
}

/**
 * Choices from the Appearance pane still being applied or saved, and whether a config change came
 * in meanwhile. That change re-reads `config.yaml` as it stood *before* the choice was written -
 * another key's save, or the choice's own write racing its reply - and applying it would switch the
 * UI back to the old language until the write's own event arrived. So a refresh waits for every
 * choice to settle, and then reads the file once.
 */
let choicesInFlight = 0;
let refreshWaiting = false;

/**
 * A language chosen in Appearance: applied at once, then persisted by `save` - the pane's write of
 * `language`, which reports its own failure and switches back. Resolves to whether the choice stood:
 * `false` when a later choice overtook it while its catalogs loaded, in which case it is neither
 * saved nor reported, since the later one will be. Rejects if its catalogs cannot be loaded. Either
 * way it settles only after the refresh it held back, if any, has run.
 */
export async function chooseLanguagePreference(
  preference: LanguagePreference,
  save: () => Promise<void>,
): Promise<boolean> {
  choicesInFlight += 1;
  try {
    if ((await applyLanguagePreference(preference)) === null) return false;
    await save();
    return true;
  } finally {
    choicesInFlight -= 1;
    if (choicesInFlight === 0 && refreshWaiting) {
      refreshWaiting = false;
      await refreshLanguage();
    }
  }
}

/**
 * Applies what `config.yaml` says now, unless a choice made in Appearance has yet to settle - then
 * once it has. A failure - an unreachable daemon, a catalog that will not load - leaves the language
 * as it is, which is a better answer than switching a user's UI to the default.
 */
export async function refreshLanguage(): Promise<SiteLocale> {
  if (choicesInFlight > 0) {
    refreshWaiting = true;
    return i18n.language;
  }
  try {
    const preference = readLanguagePreference(await bridge.getConfig());
    if (choicesInFlight > 0) {
      // A choice made while the file was being read is newer than what the file says.
      refreshWaiting = true;
    } else {
      await applyLanguagePreference(preference);
    }
  } catch {
    // Keep the current language.
  }
  return i18n.language;
}

/**
 * The start-up read, from `App`'s mount effect beside `chatLauncher.init()`. The same work as
 * {@link refreshLanguage}: `config.yaml` is the authority at start-up and after every change alike.
 */
export const initLanguage = (): Promise<SiteLocale> => refreshLanguage();
