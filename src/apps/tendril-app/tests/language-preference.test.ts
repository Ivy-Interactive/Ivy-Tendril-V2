import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridge } from "../src/api/bridge";
import { applyChangeEvent } from "../src/api/changes";
import { i18n } from "../src/i18n";
import {
  LANGUAGE_STORAGE_KEY,
  applyLanguage,
  applyLanguagePreference,
  asLanguagePreference,
  chooseLanguagePreference,
  initLanguage,
  readLanguagePreference,
  readStoredLanguagePreference,
  refreshLanguage,
  resolveLanguage,
  startupLanguage,
  systemLanguages,
} from "../src/state/language";

/**
 * The UI language setting: `config.yaml`'s top-level `language`, what it resolves to, and applying
 * it - the catalogs, `<html lang dir>`, and the `localStorage` mirror the next start paints with.
 */

const html = document.documentElement;

const setNavigatorLanguages = (languages: string[]) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(navigator, "language", "get").mockReturnValue(languages[0] ?? "");
};

beforeEach(() => {
  localStorage.clear();
  html.removeAttribute("lang");
  html.removeAttribute("dir");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
  localStorage.clear();
  html.removeAttribute("lang");
  html.removeAttribute("dir");
});

describe("asLanguagePreference", () => {
  it("keeps a locale code", () => {
    expect(asLanguagePreference("de")).toBe("de");
    expect(asLanguagePreference("zh")).toBe("zh");
  });

  it("accepts the tags a hand-edited config.yaml may hold", () => {
    expect(asLanguagePreference("pt-BR")).toBe("pt");
    expect(asLanguagePreference("DE")).toBe("de");
    expect(asLanguagePreference(" ja ")).toBe("ja");
    expect(asLanguagePreference("de-AT")).toBe("de");
  });

  it("reads system, absent, unknown and mistyped values as system", () => {
    expect(asLanguagePreference("system")).toBe("system");
    expect(asLanguagePreference(undefined)).toBe("system");
    expect(asLanguagePreference(null)).toBe("system");
    expect(asLanguagePreference("")).toBe("system");
    expect(asLanguagePreference("it")).toBe("system");
    expect(asLanguagePreference("klingon")).toBe("system");
    expect(asLanguagePreference(42)).toBe("system");
  });
});

describe("readLanguagePreference", () => {
  it("reads the top-level language key from the raw config", () => {
    expect(readLanguagePreference({ raw: { language: "sv" } })).toBe("sv");
    expect(readLanguagePreference({ raw: { language: "system" } })).toBe("system");
    expect(readLanguagePreference({ raw: {} })).toBe("system");
    expect(readLanguagePreference({})).toBe("system");
    expect(readLanguagePreference(null)).toBe("system");
  });
});

describe("resolveLanguage", () => {
  it("uses an explicit preference as it is", () => {
    expect(resolveLanguage("ru", ["de-DE"])).toBe("ru");
  });

  it("follows the operating system's languages for system", () => {
    expect(resolveLanguage("system", ["de-DE", "en"])).toBe("de");
    expect(resolveLanguage("system", ["zh-TW"])).toBe("zh");
    expect(resolveLanguage("system", ["it-IT", "fr"])).toBe("fr");
    expect(resolveLanguage("system", ["ko-KR"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
  });

  it("reads the OS languages from the webview when none are given", () => {
    setNavigatorLanguages(["pt-BR", "en-US"]);
    expect(systemLanguages()).toEqual(["pt-BR", "en-US"]);
    expect(resolveLanguage("system")).toBe("pt");
  });
});

describe("the first-paint mirror", () => {
  it("is empty until a preference is applied, and reads as system", () => {
    expect(localStorage.length).toBe(0);
    expect(readStoredLanguagePreference()).toBe("system");
  });

  it("gives the start-up language: the mirrored preference, else the OS's", () => {
    setNavigatorLanguages(["sv-SE"]);
    expect(startupLanguage()).toBe("sv");
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja");
    expect(startupLanguage()).toBe("ja");
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "nonsense");
    expect(startupLanguage()).toBe("sv");
  });

  it("reads as system when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredLanguagePreference()).toBe("system");
  });
});

describe("applying a language", () => {
  it("switches the catalogs and sets <html lang dir> to the BCP 47 tag", async () => {
    await applyLanguage("pt");
    expect(i18n.language).toBe("pt");
    expect(html.lang).toBe("pt-BR");
    expect(html.dir).toBe("ltr");

    await applyLanguage("zh");
    expect(html.lang).toBe("zh-CN");
  });

  it("remembers an explicit preference for the next start, and forgets it for system", async () => {
    setNavigatorLanguages(["en-US"]);
    await expect(applyLanguagePreference("de")).resolves.toBe("de");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
    expect(i18n.language).toBe("de");

    await expect(applyLanguagePreference("system")).resolves.toBe("en");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(i18n.language).toBe("en");
    expect(html.lang).toBe("en");
  });

  it("changes nothing when the language's catalogs fail to load", async () => {
    i18n.registerLoader("hi", () => Promise.reject(new Error("chunk failed to load")));
    await expect(applyLanguagePreference("hi")).rejects.toThrow("chunk failed to load");
    expect(i18n.language).toBe("en");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(html.hasAttribute("lang")).toBe(false);
  });
});

describe("overlapping changes", () => {
  /** A loader for `language` that holds its catalogs back until the test lets them go. */
  function holdCatalogs(language: Parameters<typeof i18n.registerLoader>[0]) {
    let release: (() => void) | undefined;
    i18n.registerLoader(
      language,
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    );
    return () => release?.();
  }

  it("neither applies nor remembers an apply that a later one overtook while it loaded", async () => {
    const releaseDe = holdCatalogs("de");
    await i18n.loadLanguages(["fr"]);

    const first = applyLanguagePreference("de");
    await expect(applyLanguagePreference("fr")).resolves.toBe("fr");
    releaseDe();

    await expect(first).resolves.toBeNull();
    expect(i18n.language).toBe("fr");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fr");
  });

  it("saves only the choice that stood, however the catalogs arrive", async () => {
    const releaseSv = holdCatalogs("sv");
    const saved: string[] = [];

    const first = chooseLanguagePreference("sv", async () => void saved.push("sv"));
    await expect(chooseLanguagePreference("es", async () => void saved.push("es"))).resolves.toBe(
      true,
    );
    releaseSv();

    await expect(first).resolves.toBe(false);
    expect(saved).toEqual(["es"]);
    expect(i18n.language).toBe("es");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("es");
  });

  it("holds a config refresh back until a choice is saved, then reads config.yaml once", async () => {
    // What a config event for an earlier, unrelated write would read: the file before the choice.
    const getConfig = vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: {} });
    let finishSave: (() => void) | undefined;
    const choice = chooseLanguagePreference(
      "ja",
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    await vi.waitFor(() => expect(finishSave).toBeDefined());
    expect(i18n.language).toBe("ja");

    await refreshLanguage();
    expect(getConfig).not.toHaveBeenCalled();
    expect(i18n.language).toBe("ja");

    getConfig.mockResolvedValue({ raw: { language: "ja" } });
    finishSave!();
    await expect(choice).resolves.toBe(true);
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(i18n.language).toBe("ja");
  });
});

describe("initLanguage and refreshLanguage", () => {
  it("apply what config.yaml says", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: { language: "ru" } });
    await expect(initLanguage()).resolves.toBe("ru");
    expect(html.lang).toBe("ru");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ru");

    vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: { language: "es" } });
    await expect(refreshLanguage()).resolves.toBe("es");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("es");
  });

  it("follow the OS when config.yaml has no language", async () => {
    setNavigatorLanguages(["fr-CA", "en"]);
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: {} });
    await expect(initLanguage()).resolves.toBe("fr");
    expect(localStorage.length).toBe(0);
  });

  it("leave the language alone when the daemon cannot be reached", async () => {
    await applyLanguage("de");
    vi.spyOn(bridge, "getConfig").mockRejectedValue(new Error("offline"));
    await expect(refreshLanguage()).resolves.toBe("de");
    expect(localStorage.length).toBe(0);
  });

  it("is what a config change runs, so a CLI or raw-editor edit applies live", () => {
    const refresh = vi.fn();
    const deps = {
      refreshPlans: vi.fn(),
      refreshPlanDetail: vi.fn(),
      refreshJobs: vi.fn(),
      refreshProjects: vi.fn(),
      refreshLanguage: refresh,
    };
    applyChangeEvent({ type: "fs.change", target: { kind: "config" } }, deps);
    expect(refresh).toHaveBeenCalledTimes(1);

    applyChangeEvent({ type: "fs.change", target: { kind: "plans", folder: null } }, deps);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
