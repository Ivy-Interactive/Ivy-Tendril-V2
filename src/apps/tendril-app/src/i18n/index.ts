/// <reference types="vite/client" />
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  createTranslation,
  type Messages,
  type SiteLocale,
  type TFunction as BoundTFunction,
} from "@ivy-interactive/components/i18n";
import type chat from "../locales/en/chat.json";
import type common from "../locales/en/common.json";
import type dashboard from "../locales/en/dashboard.json";
import type inbox from "../locales/en/inbox.json";
import type jobs from "../locales/en/jobs.json";
import type onboarding from "../locales/en/onboarding.json";
import type plans from "../locales/en/plans.json";
import type review from "../locales/en/review.json";
import type settings from "../locales/en/settings.json";
import type settingsAgents from "../locales/en/settingsAgents.json";
import type settingsProjects from "../locales/en/settingsProjects.json";

/**
 * The app's strings: its namespaces, where their catalogs live, and the `useTranslation`, `Trans`
 * and `i18n` every view imports. `docs/i18n.md` is the guide.
 *
 * ```tsx
 * import { useTranslation } from "../i18n";
 *
 * const { t } = useTranslation("chat");
 * return <textarea placeholder={t("composer.placeholder")} />;
 * ```
 *
 * The runtime is the components package's (`@ivy-interactive/components/i18n`), and it is one store:
 * the app's catalogs and the components' own sit side by side, so one `changeLanguage` switches
 * both. What this module adds is the app's half - its catalogs, and a binding typed against them,
 * so `t("chat:composer.placeholdr")` fails `tsc` instead of rendering a key.
 *
 * Every catalog is loaded on demand, English included, one chunk per language: each
 * `locales/<language>/index.ts` takes in its directory's JSON files, and this module imports those
 * ten modules lazily. {@link initI18n} fetches the chunks it needs before the first render. None of it
 * is in the eager bundle, which is the budget `tests/code-splitting.test.tsx` holds - a lazy import
 * per *file* would have put a 110-entry loader map there instead.
 */

/** The English catalogs' types, by namespace: what every key is checked against. */
export type AppResources = {
  common: typeof common;
  chat: typeof chat;
  jobs: typeof jobs;
  plans: typeof plans;
  review: typeof review;
  inbox: typeof inbox;
  dashboard: typeof dashboard;
  settings: typeof settings;
  settingsAgents: typeof settingsAgents;
  settingsProjects: typeof settingsProjects;
  onboarding: typeof onboarding;
};

export type AppNamespace = keyof AppResources;

/**
 * The registry of namespaces. A `Record` rather than a list so the compiler holds it to
 * {@link AppResources} both ways; the parity test holds the `locales/en/` files to it.
 */
const NAMESPACES: Record<AppNamespace, true> = {
  common: true,
  chat: true,
  jobs: true,
  plans: true,
  review: true,
  inbox: true,
  dashboard: true,
  settings: true,
  settingsAgents: true,
  settingsProjects: true,
  onboarding: true,
};

export const APP_NAMESPACES = Object.keys(NAMESPACES) as readonly AppNamespace[];

const isNamespace = (name: string): name is AppNamespace => Object.hasOwn(NAMESPACES, name);

/** `./chat.json` → `chat`. */
const namespaceOf = (path: string) => path.slice(path.lastIndexOf("/") + 1, -".json".length);

const translation = createTranslation<AppResources>();

/**
 * The shared store, typed for the app's namespaces. For code outside React - stores, controllers -
 * which calls `i18n.t("jobs:…")` at the moment it needs the string, never at module load.
 */
export const i18n = translation.i18n;

/** `const { t } = useTranslation("chat")`. Re-renders the component when the language changes. */
export const useTranslation = translation.useTranslation;

/** `<Trans ns="chat" i18nKey="…" components={{ link: <a … /> }} />`, for a sentence with markup. */
export const Trans = translation.Trans;

/** A namespace's `t`, for a helper that is handed one: `function columns(t: TFunction<"jobs">)`. */
export type TFunction<N extends AppNamespace> = BoundTFunction<AppResources, N>;

/** One language's catalog files, keyed by path, as the store's bundle: namespace → catalog. */
function bundleOf(files: Readonly<Record<string, Messages>>): Record<string, Messages> {
  return Object.fromEntries(
    Object.entries(files)
      .map(([path, messages]) => [namespaceOf(path), messages] as const)
      // A file that is not a registered namespace is left out; the parity test fails it.
      .filter(([namespace]) => isNamespace(namespace)),
  );
}

/** Installs one language's catalogs from their files, keyed by path as `import.meta.glob` keys them. */
export function addCatalogs(language: SiteLocale, files: Readonly<Record<string, Messages>>): void {
  for (const [namespace, messages] of Object.entries(bundleOf(files))) {
    i18n.addResourceBundle(language, namespace, messages);
  }
}

const localeModules = import.meta.glob<{ catalogs: Readonly<Record<string, Messages>> }>(
  "../locales/*/index.ts",
);

for (const language of LOCALE_CODES) {
  const load = localeModules[`../locales/${language}/index.ts`];
  if (load) i18n.registerLoader(language, async () => bundleOf((await load()).catalogs));
}

/**
 * Loads `language`'s catalogs - the app's and the components', plus English's for everything they
 * fall back to - and switches to it. `main.tsx` awaits this before the first render, so the shell
 * never paints a key or a frame of the wrong language.
 *
 * It never rejects. A language whose catalogs fail to load starts the app in English, and if English
 * itself fails the app still renders - showing keys - rather than not at all.
 */
export async function initI18n(language: SiteLocale): Promise<SiteLocale> {
  try {
    await i18n.changeLanguage(language);
  } catch {
    await i18n.changeLanguage(DEFAULT_LOCALE).catch(() => {});
  }
  return i18n.language;
}
