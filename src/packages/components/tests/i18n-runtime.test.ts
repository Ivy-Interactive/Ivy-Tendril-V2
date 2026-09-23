import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { i18nStore, type ResourceBundle } from "../src/i18n/runtime";

/**
 * The runtime behind every translated string. The store is a module singleton shared with the rest of
 * this file's imports, so the tests use a namespace of their own and put the language back after
 * each case. `tests/setup.ts` installs the throwing missing-key handler every test runs under.
 */

const NS = "testRuntime";
const t = (key: string, options?: Parameters<typeof i18nStore.t>[1]) =>
  i18nStore.t(`${NS}:${key}`, options);

beforeAll(() => {
  i18nStore.addResourceBundle("en", NS, {
    greeting: { hello: "Hello", named: "Hello, {{name}}!" },
    onlyEnglish: "Only in English",
    items_one: "{{count}} item",
    items_other: "{{count}} items",
    files_zero: "No files",
    files_one: "One file",
    files_other: "{{count}} files",
    bare: "Bare {{count}}",
    friend: "A friend",
    friend_male: "A boyfriend",
    friend_male_one: "{{count}} boyfriend",
    friend_male_other: "{{count}} boyfriends",
    raw: "{{n}}",
    spaced: "{{  name  }} and {{- name}}",
    nested: "{{plan.title}} in {{plan.project.name}}",
    twice: "{{x}}-{{x}}",
    formats: {
      number: "{{n, number}}",
      numberOptions: "{{n, number(maximumFractionDigits: 1)}}",
      percent: "{{n, percent}}",
      currency: "{{n, currency}}",
      currencyCode: "{{n, currency(EUR)}}",
      compact: "{{n, compact}}",
      list: "{{items, list}}",
      date: "{{d, date}}",
      dateOptions: "{{d, date(month: long; timeZone: UTC)}}",
      time: "{{d, time}}",
      dateTime: "{{d, dateTime}}",
      unknown: "{{n, shout}}",
    },
  });
  i18nStore.addResourceBundle("de", NS, {
    greeting: { hello: "Hallo", named: "Hallo, {{name}}!" },
    items_one: "{{count}} Element",
    items_other: "{{count}} Elemente",
  });
  i18nStore.addResourceBundle("ru", NS, {
    items_one: "{{count}} элемент",
    items_few: "{{count}} элемента",
    items_many: "{{count}} элементов",
    items_other: "{{count}} элемента (дробь)",
    files_one: "{{count}} файл",
    files_other: "{{count}} файлов",
  });
  i18nStore.addResourceBundle("ja", NS, { items_other: "{{count}} 個" });
  i18nStore.addResourceBundle("fr", NS, {
    items_one: "{{count}} élément",
    items_many: "{{count}} d’éléments",
    items_other: "{{count}} éléments",
  });
});

afterEach(async () => {
  i18nStore.setMissingKeyHandler("throw");
  await i18nStore.changeLanguage("en");
});

describe("lookup", () => {
  it("resolves a nested key by its dotted path", () => {
    expect(t("greeting.hello")).toBe("Hello");
  });

  it("uses the current language's string when it has one", async () => {
    await i18nStore.changeLanguage("de");
    expect(t("greeting.hello")).toBe("Hallo");
  });

  it("falls back to English for a key the language does not have yet", async () => {
    await i18nStore.changeLanguage("de");
    expect(t("onlyEnglish")).toBe("Only in English");
  });

  it("renders in another language on request, without switching", () => {
    expect(t("greeting.hello", { lng: "de" })).toBe("Hallo");
    expect(i18nStore.language).toBe("en");
  });

  it("binds a namespace with getFixedT, while a qualified key still reaches any namespace", () => {
    i18nStore.addResourceBundle("en", "testOther", { title: "Other" });
    const fixed = i18nStore.getFixedT(null, NS);
    expect(fixed("greeting.hello")).toBe("Hello");
    expect(fixed("testOther:title")).toBe("Other");
  });

  it("never resolves an object, or a property every object inherits", () => {
    expect(() => t("greeting")).toThrow(/"testRuntime:greeting" is not in the English catalog/);
    expect(() => t("constructor")).toThrow(/is not in the English catalog/);
    expect(() => t("greeting.hello.length")).toThrow(/is not in the English catalog/);
  });

  it("tells whether a key exists without reporting it", () => {
    expect(i18nStore.exists(`${NS}:greeting.hello`)).toBe(true);
    expect(i18nStore.exists(`${NS}:items`, { count: 2 })).toBe(true);
    expect(i18nStore.exists(`${NS}:greeting.nope`)).toBe(false);
    expect(i18nStore.exists("greeting.hello")).toBe(false);
  });
});

describe("missing translations", () => {
  it("throws under the test setup, naming the key", () => {
    expect(() => t("does.not.exist")).toThrow(
      '[i18n] "testRuntime:does.not.exist" is not in the English catalog',
    );
  });

  it("names both catalogs when the language is not English", async () => {
    await i18nStore.changeLanguage("de");
    expect(() => t("does.not.exist")).toThrow(
      '[i18n] "testRuntime:does.not.exist" is in neither the "de" catalog nor the English one',
    );
  });

  it("renders the key itself, as i18next does, when the handler does not throw", () => {
    i18nStore.setMissingKeyHandler("ignore");
    expect(t("does.not.exist")).toBe("does.not.exist");
  });

  it("warns once per problem in warn mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    i18nStore.setMissingKeyHandler("warn");
    t("warned.once");
    t("warned.once");
    t("warned.twice");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      '[i18n] "testRuntime:warned.once" is not in the English catalog',
    );
    warn.mockRestore();
  });

  it("hands a custom handler the details", () => {
    const handler = vi.fn();
    i18nStore.setMissingKeyHandler(handler);
    t("missing.key", { lng: "ru" });
    t("greeting.named", {});
    expect(handler).toHaveBeenNthCalledWith(1, {
      kind: "key",
      language: "ru",
      namespace: NS,
      key: "missing.key",
    });
    expect(handler).toHaveBeenNthCalledWith(2, {
      kind: "variable",
      language: "en",
      namespace: NS,
      key: "greeting.named",
      name: "name",
    });
  });

  it("reports a key with no namespace", () => {
    expect(() => i18nStore.t("greeting.hello")).toThrow(
      '[i18n] "greeting.hello" names no namespace: write it as "namespace:greeting.hello"',
    );
  });
});

describe("interpolation", () => {
  it("fills {{variables}} with String(value), leaving numbers unformatted", async () => {
    expect(t("greeting.named", { name: "Ada" })).toBe("Hello, Ada!");
    await i18nStore.changeLanguage("de");
    // A plain placeholder is never localised: English output must stay byte-identical to the
    // template literals the strings were extracted from.
    expect(t("raw", { n: 1234.5 })).toBe("1234.5");
  });

  it("tolerates whitespace and i18next's unescaped `{{- name}}` form", () => {
    expect(t("spaced", { name: "x" })).toBe("x and x");
  });

  it("follows dots into nested values", () => {
    expect(t("nested", { plan: { title: "Split", project: { name: "Tendril" } } })).toBe(
      "Split in Tendril",
    );
  });

  it("fills every occurrence of a repeated variable", () => {
    expect(t("twice", { x: 7 })).toBe("7-7");
  });

  it("renders null, and a variable passed as undefined, as nothing", () => {
    expect(t("greeting.named", { name: null })).toBe("Hello, !");
    expect(t("greeting.named", { name: undefined })).toBe("Hello, !");
  });

  it("reports a variable that was never passed, and renders it as nothing otherwise", () => {
    expect(() => t("greeting.named")).toThrow(
      '[i18n] "testRuntime:greeting.named" interpolates {{name}}, but no value of that name was passed',
    );
    i18nStore.setMissingKeyHandler("ignore");
    expect(t("greeting.named")).toBe("Hello, !");
  });

  it("never escapes: React escapes what it renders", () => {
    expect(t("greeting.named", { name: `<b>"Tom" & 'Jerry'</b>` })).toBe(
      `Hello, <b>"Tom" & 'Jerry'</b>!`,
    );
  });

  it("formats numbers, percentages, currency and compact numbers in the current language", async () => {
    expect(t("formats.number", { n: 1234.5 })).toBe("1,234.5");
    expect(t("formats.numberOptions", { n: 1.2345 })).toBe("1.2");
    expect(t("formats.percent", { n: 0.25 })).toBe("25%");
    expect(t("formats.currency", { n: 3.5 })).toBe("$3.50");
    expect(t("formats.currencyCode", { n: 3.5 })).toBe("€3.50");
    expect(t("formats.compact", { n: 2_500_000 })).toBe("2.5M");

    await i18nStore.changeLanguage("de");
    expect(t("formats.number", { n: 1234.5 })).toBe("1.234,5");
    expect(t("formats.percent", { n: 0.25 })).toBe("25 %");
    expect(t("formats.currency", { n: 3.5 })).toBe("3,50 $");
    expect(t("formats.compact", { n: 2_500_000 })).toBe("2,5 Mio.");
  });

  it("formats lists in the current language", async () => {
    expect(t("formats.list", { items: ["a", "b", "c"] })).toBe("a, b, and c");
    await i18nStore.changeLanguage("de");
    expect(t("formats.list", { items: ["a", "b", "c"] })).toBe("a, b und c");
  });

  it("formats dates and times, with i18next's inline options, from a Date, a number or a string", () => {
    const moment = new Date(Date.UTC(2026, 8, 22, 15, 4));
    const intl = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en", options).format(moment);

    expect(t("formats.date", { d: moment })).toBe(intl({ dateStyle: "medium" }));
    expect(t("formats.date", { d: moment.getTime() })).toBe(intl({ dateStyle: "medium" }));
    expect(t("formats.date", { d: moment.toISOString() })).toBe(intl({ dateStyle: "medium" }));
    expect(t("formats.time", { d: moment })).toBe(intl({ timeStyle: "short" }));
    // The format name is case-insensitive, as it is in i18next: `dateTime` is `datetime`.
    expect(t("formats.dateTime", { d: moment })).toBe(
      intl({ dateStyle: "medium", timeStyle: "short" }),
    );
    expect(t("formats.dateOptions", { d: moment })).toBe("September");
  });

  it("reports a format it does not know, and falls back to the plain value", () => {
    expect(() => t("formats.unknown", { n: 5 })).toThrow(/uses "shout", which is not a format/);
    i18nStore.setMissingKeyHandler("ignore");
    expect(t("formats.unknown", { n: 5 })).toBe("5");
  });
});

describe("plurals", () => {
  it("picks _one and _other by the language's plural rules", () => {
    expect(t("items", { count: 1 })).toBe("1 item");
    expect(t("items", { count: 2 })).toBe("2 items");
    expect(t("items", { count: 0 })).toBe("0 items");
    expect(t("items", { count: 1, lng: "de" })).toBe("1 Element");
    expect(t("items", { count: 5, lng: "de" })).toBe("5 Elemente");
  });

  it("prefers _zero for a count of exactly 0, when the key has one", () => {
    expect(t("files", { count: 0 })).toBe("No files");
    expect(t("files", { count: 1 })).toBe("One file");
    expect(t("files", { count: 3 })).toBe("3 files");
  });

  it("gives Russian its one, few and many forms, and other for fractions", () => {
    const ru = (count: number) => t("items", { count, lng: "ru" });
    expect(ru(1)).toBe("1 элемент");
    expect(ru(21)).toBe("21 элемент");
    expect(ru(2)).toBe("2 элемента");
    expect(ru(4)).toBe("4 элемента");
    expect(ru(5)).toBe("5 элементов");
    expect(ru(11)).toBe("11 элементов");
    expect(ru(0)).toBe("0 элементов");
    expect(ru(1.5)).toBe("1.5 элемента (дробь)");
  });

  it("gives Japanese its single form for every count", () => {
    expect(t("items", { count: 1, lng: "ja" })).toBe("1 個");
    expect(t("items", { count: 2, lng: "ja" })).toBe("2 個");
  });

  it("uses French's one for 0 and 1, and many for exact millions", () => {
    expect(t("items", { count: 0, lng: "fr" })).toBe("0 élément");
    expect(t("items", { count: 1, lng: "fr" })).toBe("1 élément");
    expect(t("items", { count: 1_000_000, lng: "fr" })).toBe("1000000 d’éléments");
    expect(t("items", { count: 7, lng: "fr" })).toBe("7 éléments");
  });

  it("falls back from a missing category to _other in the same language before English", () => {
    // `files` has no `_few` in Russian: 3 is "few", and the Russian `_other` is used.
    expect(t("files", { count: 3, lng: "ru" })).toBe("3 файлов");
  });

  it("falls back to the bare key when the key has no plural forms", () => {
    expect(t("bare", { count: 3 })).toBe("Bare 3");
  });

  it("falls back to English's forms, chosen by English's rules, when the language has none", () => {
    // 21 is Russian "one", but the English fallback must not say "21 item".
    expect(t("items", { count: 21, lng: "sv" })).toBe("21 items");
    expect(t("files", { count: 21, lng: "de" })).toBe("21 files");
  });

  it("does not pluralise on a string count, as i18next does not", () => {
    expect(t("bare", { count: "3" as unknown as number })).toBe("Bare 3");
  });
});

describe("context", () => {
  it("selects key_<context>, falling back to the key without it", () => {
    expect(t("friend", { context: "male" })).toBe("A boyfriend");
    expect(t("friend", { context: "female" })).toBe("A friend");
    expect(t("friend")).toBe("A friend");
  });

  it("combines with plurals as key_<context>_<form>", () => {
    expect(t("friend", { context: "male", count: 1 })).toBe("1 boyfriend");
    expect(t("friend", { context: "male", count: 2 })).toBe("2 boyfriends");
  });
});

describe("changing language", () => {
  it("switches before returning when the catalogs are already loaded", async () => {
    await i18nStore.changeLanguage("de");
    await i18nStore.changeLanguage("en");

    const pending = i18nStore.changeLanguage("de");
    expect(i18nStore.language).toBe("de");
    await pending;
  });

  it("notifies subscribers once per change, and not for the language it is already in", async () => {
    const listener = vi.fn();
    const unsubscribe = i18nStore.subscribe(listener);
    await i18nStore.changeLanguage("de");
    expect(listener).toHaveBeenCalledTimes(1);
    await i18nStore.changeLanguage("de");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await i18nStore.changeLanguage("en");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishes a new snapshot on every change, and keeps it stable in between", async () => {
    const before = i18nStore.getSnapshot();
    expect(i18nStore.getSnapshot()).toBe(before);
    await i18nStore.changeLanguage("de");
    const after = i18nStore.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.language).toBe("de");
  });

  it("re-renders when a catalog on screen is replaced, and not for a first registration", () => {
    const listener = vi.fn();
    const unsubscribe = i18nStore.subscribe(listener);
    // A namespace's first catalog: nothing can have rendered its strings yet.
    i18nStore.addResourceBundle("en", "testLate", { late: "Late" });
    i18nStore.addResourceBundle("hi", "testLate", { late: "देर" });
    expect(listener).not.toHaveBeenCalled();

    i18nStore.addResourceBundle("en", "testLate", { late: "Later" });
    expect(listener).toHaveBeenCalledTimes(1);
    // English is on screen; a replaced Hindi catalog cannot change anything rendered.
    i18nStore.addResourceBundle("hi", "testLate", { late: "बाद में" });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("loads a language's registered catalogs before switching to it", async () => {
    let resolve!: (bundle: ResourceBundle) => void;
    const loader = vi.fn(() => new Promise<ResourceBundle>((done) => (resolve = done)));
    i18nStore.registerLoader("sv", loader);

    const pending = i18nStore.changeLanguage("sv");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(i18nStore.language).toBe("en");

    resolve({ [NS]: { greeting: { hello: "Hej" } } });
    await pending;
    expect(i18nStore.language).toBe("sv");
    expect(t("greeting.hello")).toBe("Hej");

    // A loader that has succeeded never runs again.
    await i18nStore.changeLanguage("en");
    await i18nStore.changeLanguage("sv");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("rejects and keeps the language when a catalog fails to load, and retries next time", async () => {
    const loader = vi
      .fn<() => Promise<ResourceBundle>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce({ [NS]: { greeting: { hello: "नमस्ते" } } });
    i18nStore.registerLoader("hi", loader);

    await expect(i18nStore.changeLanguage("hi")).rejects.toThrow("chunk failed");
    expect(i18nStore.language).toBe("en");

    await i18nStore.changeLanguage("hi");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(t("greeting.hello")).toBe("नमस्ते");
  });

  it("lets the latest request win when two loads overlap", async () => {
    let finishSlow!: (bundle: ResourceBundle) => void;
    i18nStore.registerLoader("es", () => new Promise((done) => (finishSlow = done)));

    const slow = i18nStore.changeLanguage("es");
    await i18nStore.changeLanguage("de");
    finishSlow({});
    await slow;
    expect(i18nStore.language).toBe("de");
  });

  it("rejects a code that is not a Tendril locale", async () => {
    await expect(i18nStore.changeLanguage("it" as never)).rejects.toThrow(
      '[i18n] "it" is not a Tendril locale',
    );
    expect(i18nStore.language).toBe("en");
  });

  it("gives getFixedT(null) the language at call time, and a named language for good", async () => {
    const current = i18nStore.getFixedT(null, NS);
    const german = i18nStore.getFixedT("de", NS);
    expect(current("greeting.hello")).toBe("Hello");
    expect(german("greeting.hello")).toBe("Hallo");

    await i18nStore.changeLanguage("de");
    expect(current("greeting.hello")).toBe("Hallo");
    await i18nStore.changeLanguage("en");
    expect(german("greeting.hello")).toBe("Hallo");
  });
});
