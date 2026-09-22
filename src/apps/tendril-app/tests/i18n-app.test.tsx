import { afterEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import {
  APP_NAMESPACES,
  addCatalogs,
  i18n,
  initI18n,
  useTranslation,
  Trans,
  type TFunction,
} from "../src/i18n";

/**
 * The app's binding to the shared runtime: its catalogs load on demand, `initI18n` never leaves the
 * app unable to render, and every key is checked against the English catalogs at compile time.
 */

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("the app's catalogs", () => {
  it("are all installed in English by the test setup, as initI18n installs them in the app", () => {
    for (const namespace of APP_NAMESPACES) {
      expect(i18n.hasResourceBundle("en", namespace), namespace).toBe(true);
    }
    expect(i18n.t("common:actions.cancel")).toBe("Cancel");
  });

  it("ignore a file that is not a registered namespace", () => {
    addCatalogs("sv", { "../locales/sv/notANamespace.json": { title: "x" } });
    expect(i18n.hasResourceBundle("sv", "notANamespace")).toBe(false);
  });
});

describe("initI18n", () => {
  it("loads a language's catalogs, the app's and the component package's, and switches to it", async () => {
    await expect(initI18n("de")).resolves.toBe("de");
    expect(i18n.language).toBe("de");
    for (const namespace of APP_NAMESPACES) {
      expect(i18n.hasResourceBundle("de", namespace), namespace).toBe(true);
    }
    expect(i18n.hasResourceBundle("de", "uiDialogs")).toBe(true);
    // Nothing is translated yet, so every string still renders its English fallback.
    expect(i18n.t("common:enums.jobStatus.running")).toBe("Running");
  });

  it("starts the app in English when a language's catalogs fail to load", async () => {
    i18n.registerLoader("ru", () => Promise.reject(new Error("chunk failed to load")));
    await expect(initI18n("ru")).resolves.toBe("en");
    expect(i18n.language).toBe("en");
  });
});

/** Compile-time only: every `@ts-expect-error` is a key that must not type-check. Never called. */
export function keysAreChecked(): unknown[] {
  const t = i18n.getFixedT(null, "settings");
  return [
    i18n.t("common:actions.cancel"),
    i18n.t("common:enums.planState.icebox"),
    t("appearance.language.saved", { language: "Deutsch" }),
    t("common:status.loading"),
    // @ts-expect-error - not a key of common
    i18n.t("common:actions.nope"),
    // @ts-expect-error - not a namespace of the app
    i18n.t("nope:title"),
    // @ts-expect-error - a key of another namespace must be qualified
    t("actions.cancel"),
    // @ts-expect-error - the component package's namespaces are its own, not the app's
    i18n.getFixedT(null, "uiCommon"),
  ];
}

export function HooksAreChecked() {
  const { t } = useTranslation("common");
  // @ts-expect-error - an empty namespace has no keys until its English catalog gets some
  const empty = useTranslation("chat").t("anything");
  return (
    <>
      {t("actions.save")}
      {empty}
      <Trans ns="settings" i18nKey="appearance.language.title" />
      {/* @ts-expect-error - not a key of settings */}
      <Trans ns="settings" i18nKey="appearance.nope" />
    </>
  );
}

/** A namespace's `TFunction` is the `t` its `useTranslation` returns, for helpers handed one. */
export function cancelLabel(t: TFunction<"common">): string {
  // @ts-expect-error - not a key of common
  void t("actions.nope");
  return t("actions.cancel");
}

export function HelpersAreChecked() {
  const common = useTranslation("common").t;
  const settings = useTranslation("settings").t;
  return (
    <>
      {cancelLabel(common)}
      {
        // @ts-expect-error - a settings `t` does not take common's bare keys
        cancelLabel(settings)
      }
    </>
  );
}
