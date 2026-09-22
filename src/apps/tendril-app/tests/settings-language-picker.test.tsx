import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SITE_LOCALES } from "@ivy-interactive/components/i18n";
import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import { i18n } from "../src/i18n";
import { LANGUAGE_STORAGE_KEY } from "../src/state/language";
import { notificationsStore } from "../src/state/notificationsStore";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";
import germanSettings from "../src/locales/de/settings.json";

/** The toast is worded after the switch, so it is already German - read from the German catalog
 *  rather than spelled out, so a reworded translation does not break this test. */
const GERMAN_SAVED_TOAST = [
  germanSettings.shared.toastSaved,
  germanSettings.appearance.language.saved.replace("{{language}}", "Deutsch"),
] as const;

/**
 * The Language block in Settings > Appearance: every language by its own name, applied on the change
 * and persisted to `config.yaml`'s `language` like the rest of the pane, and rolled back when either
 * half fails. Modelled on the docs site's language-switcher test.
 */

const baseConfig: TendrilConfig = {
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
  raw: { staleOutputTimeout: 10, beta: false, themeMode: "system", theme: "default" },
};

const serviceInfo: ServiceInfo = {
  state: "Connected",
  tendrilHome: "/home/user/.tendril",
  port: 5010,
  host: "127.0.0.1",
  ownership: "Managed",
  statusBadge: "Connected (Managed)",
  capabilities: ["plans"],
  message: "Online",
};

const html = document.documentElement;
/** The picker's label is in whatever language is current, which a choice changes mid-test. */
const picker = () =>
  screen.getByLabelText(i18n.t("settings:appearance.language.label")) as HTMLSelectElement;

async function renderAppearance(config: TendrilConfig = baseConfig) {
  vi.spyOn(bridge, "getConfig").mockResolvedValue(config);
  await act(async () => {
    render(
      <SettingsView
        serviceInfo={serviceInfo}
        onRefreshHealth={vi.fn()}
        initialSection="appearance"
      />,
    );
  });
}

/**
 * The change applies the language - loading its catalogs, which is a dynamic import the first time -
 * and only then writes it, so each test waits for the end state it asserts rather than for `act`.
 */
async function choose(value: string) {
  await act(async () => {
    fireEvent.change(picker(), { target: { value } });
  });
}

describe("Settings / Appearance / Language", () => {
  let putConfig: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    localStorage.clear();
    html.removeAttribute("lang");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    localStorage.clear();
    html.removeAttribute("lang");
    html.removeAttribute("dir");
  });

  it("offers System default and the ten languages, each by its own name", async () => {
    await renderAppearance();

    const options = Array.from(picker().options);
    expect(options.map((option) => option.value)).toEqual([
      "system",
      "en",
      "de",
      "ja",
      "es",
      "fr",
      "pt",
      "zh",
      "ru",
      "sv",
      "hi",
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      "System default",
      "English",
      "Deutsch",
      "日本語",
      "Español",
      "Français",
      "Português (Brasil)",
      "简体中文",
      "Русский",
      "Svenska",
      "हिन्दी",
    ]);
  });

  it("marks each language's name with its language, and leaves System default unmarked", async () => {
    await renderAppearance();

    const options = Array.from(picker().options);
    expect(options[0].hasAttribute("lang")).toBe(false);
    for (const locale of SITE_LOCALES) {
      const option = options.find((candidate) => candidate.value === locale.code)!;
      expect(option.getAttribute("lang")).toBe(locale.hreflang);
    }
  });

  it("shows what config.yaml holds", async () => {
    await renderAppearance({ ...baseConfig, raw: { ...baseConfig.raw, language: "sv" } });
    expect(picker().value).toBe("sv");
  });

  it("shows System default when config.yaml has no language", async () => {
    await renderAppearance();
    expect(picker().value).toBe("system");
  });

  it("applies and persists a language on the change", async () => {
    const notify = vi.spyOn(notificationsStore, "notifySuccess");
    await renderAppearance();

    await choose("de");

    await waitFor(() => expect(notify).toHaveBeenCalledWith(...GERMAN_SAVED_TOAST));
    expect(putConfig).toHaveBeenCalledWith("language", "de");
    expect(i18n.language).toBe("de");
    expect(html.lang).toBe("de");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
  });

  it("persists System default as system, and follows the OS again", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP", "en"]);
    await renderAppearance({ ...baseConfig, raw: { ...baseConfig.raw, language: "de" } });

    await choose("system");

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith("language", "system"));
    expect(i18n.language).toBe("ja");
    expect(html.lang).toBe("ja");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("writes only the last of two quick choices, whichever catalogs arrive last", async () => {
    // Russian's catalogs are still loading when Deutsch, already loaded, is chosen.
    let releaseRussian: (() => void) | undefined;
    i18n.registerLoader(
      "ru",
      () =>
        new Promise((resolve) => {
          releaseRussian = () => resolve({});
        }),
    );
    await i18n.loadLanguages(["de"]);
    const notify = vi.spyOn(notificationsStore, "notifySuccess");
    await renderAppearance();

    await choose("ru");
    await choose("de");
    await waitFor(() => expect(notify).toHaveBeenCalledWith(...GERMAN_SAVED_TOAST));
    await act(async () => {
      releaseRussian!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenLastCalledWith("language", "de");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(i18n.language).toBe("de");
    expect(picker().value).toBe("de");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
  });

  it("switches back when the write fails", async () => {
    putConfig.mockRejectedValue(new Error("disk full"));
    await renderAppearance();

    await choose("fr");

    await waitFor(() =>
      expect(screen.getByTestId("appearance-card")).toHaveTextContent("Failed to save"),
    );
    expect(putConfig).toHaveBeenCalledWith("language", "fr");
    await waitFor(() => expect(i18n.language).toBe("en"));
    expect(picker().value).toBe("system");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("neither switches nor persists a language whose catalogs will not load", async () => {
    i18n.registerLoader("hi", () => Promise.reject(new Error("chunk failed to load")));
    await renderAppearance();

    await choose("hi");

    await waitFor(() =>
      expect(
        within(screen.getByTestId("appearance-card")).getByText(
          "Could not load हिन्दी. Tendril stays in the language it was in.",
        ),
      ).toBeInTheDocument(),
    );
    expect(putConfig).not.toHaveBeenCalled();
    expect(picker().value).toBe("system");
    expect(i18n.language).toBe("en");
  });
});
