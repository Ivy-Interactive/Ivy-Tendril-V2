import "@testing-library/jest-dom";
import { act, render, renderHook, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { createTranslation, useFormatters, useLocale } from "../src/i18n/react";
import { i18nStore } from "../src/i18n/runtime";

/**
 * The React bindings: `useTranslation`, `useLocale` and `useFormatters` follow `changeLanguage` with
 * no provider, and `t` changes identity exactly when the language does.
 */

const english = {
  title: "Settings",
  count_one: "{{count}} project",
  count_other: "{{count}} projects",
};
type Resources = { testHooks: typeof english };
const { useTranslation, i18n } = createTranslation<Resources>();

beforeAll(() => {
  i18nStore.addResourceBundle("en", "testHooks", english);
  i18nStore.addResourceBundle("de", "testHooks", {
    title: "Einstellungen",
    count_one: "{{count}} Projekt",
    count_other: "{{count}} Projekte",
  });
});

afterEach(async () => {
  await act(async () => {
    await i18nStore.changeLanguage("en");
  });
});

const switchTo = (language: Parameters<typeof i18nStore.changeLanguage>[0]) =>
  act(async () => {
    await i18nStore.changeLanguage(language);
  });

function Title({ count }: { count: number }) {
  const { t } = useTranslation("testHooks");
  return (
    <p>
      {t("title")}: {t("count", { count })}
    </p>
  );
}

describe("useTranslation", () => {
  it("renders English with no provider and no setup", () => {
    render(<Title count={2} />);
    expect(screen.getByText("Settings: 2 projects")).toBeInTheDocument();
  });

  it("re-renders every translating component when the language changes", async () => {
    render(<Title count={1} />);
    await switchTo("de");
    expect(screen.getByText("Einstellungen: 1 Projekt")).toBeInTheDocument();
    await switchTo("en");
    expect(screen.getByText("Settings: 1 project")).toBeInTheDocument();
  });

  it("keeps t stable while nothing changes, and gives it a new identity on a language change", async () => {
    const { result, rerender } = renderHook(() => useTranslation("testHooks"));
    const first = result.current.t;
    rerender();
    expect(result.current.t).toBe(first);

    await switchTo("de");
    expect(result.current.t).not.toBe(first);
    expect(result.current.t("title")).toBe("Einstellungen");
  });

  it("recomputes memoized output that depends on t", async () => {
    let computed = 0;
    function Memoized() {
      const { t } = useTranslation("testHooks");
      const label = React.useMemo(() => {
        computed += 1;
        return t("title");
      }, [t]);
      return <span>{label}</span>;
    }

    const { rerender } = render(<Memoized />);
    rerender(<Memoized />);
    expect(computed).toBe(1);
    await switchTo("de");
    expect(screen.getByText("Einstellungen")).toBeInTheDocument();
    expect(computed).toBe(2);
  });

  it("hands back the shared store as i18n", () => {
    const { result } = renderHook(() => useTranslation("testHooks"));
    expect(result.current.i18n).toBe(i18n);
    expect(result.current.i18n.language).toBe("en");
  });
});

describe("useLocale", () => {
  it("reports the language with its BCP 47 tag and direction, and follows changes", async () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current).toEqual({ language: "en", hreflang: "en", dir: "ltr" });

    await switchTo("pt");
    expect(result.current).toEqual({ language: "pt", hreflang: "pt-BR", dir: "ltr" });
    await switchTo("zh");
    expect(result.current).toEqual({ language: "zh", hreflang: "zh-CN", dir: "ltr" });
  });
});

describe("useFormatters", () => {
  it("formats in the current language and follows changes", async () => {
    const { result } = renderHook(() => useFormatters());
    expect(result.current.number(1234.5)).toBe("1,234.5");
    expect(result.current.currency(3.5)).toBe("$3.50");
    expect(result.current.list(["a", "b"])).toBe("a and b");

    await switchTo("de");
    expect(result.current.number(1234.5)).toBe("1.234,5");
    expect(result.current.currency(3.5)).toBe("3,50\u00a0$");
    expect(result.current.list(["a", "b"])).toBe("a und b");
  });

  it("returns the same formatters for the same language", async () => {
    const { result, rerender } = renderHook(() => useFormatters());
    const english = result.current;
    rerender();
    expect(result.current).toBe(english);
    await switchTo("ja");
    expect(result.current).not.toBe(english);
  });
});
