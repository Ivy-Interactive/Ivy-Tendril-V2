import { ThemeProvider } from "@ivy-interactive/components/theme";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DocsLayout } from "../src/components/DocsLayout";
import { navTree, pageForRoute, pages } from "../src/content";

function renderDocs(route: string) {
  return render(
    <ThemeProvider defaultTheme="light" storageKey={`test-theme-${Math.random()}`}>
      <DocsLayout
        route={route}
        sections={navTree}
        lookupPage={pageForRoute}
        allPages={pages.values()}
      />
    </ThemeProvider>,
  );
}

describe("Content fallback and localized UI chrome", () => {
  beforeEach(() => {
    // Reset document lang/dir
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    document.querySelectorAll("link[rel='alternate']").forEach((el) => el.remove());
  });

  it("renders English markdown prose when visiting a localized route (/de/docs/concepts/plans)", () => {
    renderDocs("/de/docs/concepts/plans");

    // The heading of the English Plans page is rendered
    expect(screen.getByRole("heading", { level: 1, name: "Plans" })).toBeInTheDocument();
  });

  it("renders the UntranslatedNotice banner in German when visiting /de/docs/concepts/plans", () => {
    renderDocs("/de/docs/concepts/plans");

    const notice = screen.getByRole("note", { name: "Diese Seite ist noch nicht übersetzt" });
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent("Diese Seite ist noch nicht übersetzt");
    expect(notice).toHaveTextContent(
      "Sie sehen die englische Version dieses Artikels. Für die ausgewählte Sprache ist noch keine Übersetzung verfügbar.",
    );
  });

  it("does NOT render the UntranslatedNotice banner when on the default English route", () => {
    renderDocs("/docs/concepts/plans");

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("adapts 'On this page' rail to the active locale", () => {
    renderDocs("/de/docs/concepts/plans");

    const rail = screen.getByLabelText("Auf dieser Seite");
    expect(rail).toBeInTheDocument();
    expect(rail).toHaveTextContent("Auf dieser Seite");
  });

  it("adapts pager links (Previous/Next) to the active locale", () => {
    renderDocs("/de/docs/concepts/plans");

    expect(screen.getByText("Zurück")).toBeInTheDocument();
    expect(screen.getByText("Weiter")).toBeInTheDocument();
  });

  it("renders localized 404 page under locale prefix", () => {
    renderDocs("/de/docs/non-existent-page");

    expect(
      screen.getByRole("heading", { level: 1, name: "Seite nicht gefunden" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nichts veröffentlicht unter/)).toBeInTheDocument();
  });

  it("synchronizes HTML document lang, dir, og:locale and 11 hreflang alternate links", async () => {
    renderDocs("/pt/docs/concepts/plans");

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("pt-BR");
      expect(document.documentElement.dir).toBe("ltr");
    });

    const ogLocaleMeta = document.querySelector('meta[property="og:locale"]');
    expect(ogLocaleMeta).toHaveAttribute("content", "pt_BR");

    const canonicalLink = document.querySelector('link[rel="canonical"]');
    expect(canonicalLink).toHaveAttribute("href", "https://docs.ivy.app/pt/docs/concepts/plans");

    const alternateLinks = document.querySelectorAll("link[rel='alternate']");
    expect(alternateLinks).toHaveLength(11);

    const xDefault = document.querySelector("link[rel='alternate'][hreflang='x-default']");
    expect(xDefault).toHaveAttribute("href", "https://docs.ivy.app/docs/concepts/plans");

    const ptAlternate = document.querySelector("link[rel='alternate'][hreflang='pt-BR']");
    expect(ptAlternate).toHaveAttribute("href", "https://docs.ivy.app/pt/docs/concepts/plans");

    const zhAlternate = document.querySelector("link[rel='alternate'][hreflang='zh-CN']");
    expect(zhAlternate).toHaveAttribute("href", "https://docs.ivy.app/zh/docs/concepts/plans");
  });
});
