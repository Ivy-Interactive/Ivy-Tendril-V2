/**
 * End-to-end render of the real `content/` folder through the real chrome.
 *
 * This is the test that proves the whole pipeline agrees: the nav tree comes from the folder, the
 * article comes from the markdown, intra-doc links reach the DOM as final routes, code fences are
 * highlighted, and the theme is the `globals.css` token set rather than a docs-specific one.
 */
import { ThemeProvider } from "@ivy-interactive/components/theme";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocsLayout } from "../src/components/DocsLayout";

function renderDocs(route: string, theme: "light" | "dark" | "system" = "light") {
  return render(
    <ThemeProvider defaultTheme={theme} storageKey={`tendril-docs-theme-test-${Math.random()}`}>
      <DocsLayout route={route} />
    </ThemeProvider>,
  );
}

function article(): HTMLElement {
  const found = document.querySelector("article.docs-article");
  if (!(found instanceof HTMLElement)) throw new Error("No docs article rendered");
  return found;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/docs/concepts/plans");
  localStorage.clear();
  document.documentElement.classList.remove("light", "dark");
});

afterEach(() => {
  document.documentElement.classList.remove("light", "dark");
});

describe("DocsLayout", () => {
  it("renders the requested page", async () => {
    renderDocs("/docs/concepts/plans");

    const heading = await screen.findByRole("heading", { level: 1, name: "Plans" });
    expect(heading).toHaveAttribute("id", "top");
    expect(article()).toHaveAttribute("data-content-path", "02_Concepts/01_Plans.md");
    await waitFor(() => {
      expect(document.title).toBe("Plans · Tendril Docs");
    });
  });

  it("renders the section navigation for the whole site", async () => {
    renderDocs("/docs/concepts/plans");
    await screen.findByRole("heading", { level: 1, name: "Plans" });

    const sidebar = screen.getByRole("navigation", { name: "Documentation sections" });
    expect(within(sidebar).getByRole("link", { name: "Getting Started" })).toHaveAttribute(
      "href",
      "/docs/gettingstarted",
    );
    expect(within(sidebar).getByRole("link", { name: "Concepts" })).toHaveAttribute(
      "href",
      "/docs/concepts",
    );
    // Both sections are `groupExpanded`, so every page is listed without any interaction.
    expect(within(sidebar).getByRole("link", { name: "Welcome to Ivy Tendril" })).toHaveAttribute(
      "href",
      "/docs/gettingstarted/introduction",
    );
    expect(within(sidebar).getByRole("link", { name: "Plans", current: "page" })).toHaveAttribute(
      "href",
      "/docs/concepts/plans",
    );
  });

  it("renders translated section and page titles in the sidebar when localized route is visited", async () => {
    renderDocs("/es/docs/concepts/plans");
    await screen.findByRole("heading", { level: 1, name: "Planes" });

    const sidebar = screen.getByRole("navigation", { name: "Secciones de la documentación" });
    expect(within(sidebar).getByRole("link", { name: "Primeros pasos" })).toHaveAttribute(
      "href",
      "/es/docs/gettingstarted",
    );
    expect(within(sidebar).getByRole("link", { name: "Conceptos" })).toHaveAttribute(
      "href",
      "/es/docs/concepts",
    );
    expect(within(sidebar).getByRole("link", { name: "Bienvenido a Ivy Tendril" })).toHaveAttribute(
      "href",
      "/es/docs/gettingstarted/introduction",
    );
    expect(within(sidebar).getByRole("link", { name: "Planes", current: "page" })).toHaveAttribute(
      "href",
      "/es/docs/concepts/plans",
    );
  });

  it("rewrites a relative .md link to its route before the DOM sees it", async () => {
    renderDocs("/docs/concepts/plans");
    await screen.findByRole("heading", { level: 1, name: "Plans" });

    await waitFor(() => {
      expect(article().querySelectorAll("a").length).toBeGreaterThan(0);
    });

    const hrefs = [...article().querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"));
    expect(hrefs).toContain("/docs/concepts/lifecycle");
    expect(hrefs).toContain("/docs/concepts/promptwares");
    // No authored relative path and no mangled route survives into the DOM.
    expect(hrefs.some((href) => href?.includes(".md"))).toBe(false);
    expect(hrefs.some((href) => href?.startsWith("/../"))).toBe(false);
  });

  it("highlights fenced code blocks", async () => {
    renderDocs("/docs/concepts/plans");
    await screen.findByRole("heading", { level: 1, name: "Plans" });

    const block = await waitFor(() => {
      const found = article().querySelector(".markdown-code-block code[class*='language-']");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(block.querySelectorAll("span").length).toBeGreaterThan(0);
    expect(article().textContent).toContain("tendril plan list");
  });

  it("lists the page's own headings in the On this page rail", async () => {
    renderDocs("/docs/concepts/plans");
    await screen.findByRole("heading", { level: 1, name: "Plans" });

    const rail = screen.getByRole("complementary", { name: "On this page" });
    expect(within(rail).getByRole("link", { name: "Plan states" })).toHaveAttribute(
      "href",
      "#plan-states",
    );
  });

  it("offers previous/next links in reading order", async () => {
    renderDocs("/docs/concepts/plans");
    await screen.findByRole("heading", { level: 1, name: "Plans" });

    const pager = screen.getByRole("navigation", { name: "Page navigation" });
    expect(within(pager).getByText("Concepts")).toBeInTheDocument();
    expect(within(pager).getByText("Promptwares")).toBeInTheDocument();
  });

  it("renders the 404 page for an unknown route", async () => {
    renderDocs("/docs/nope");
    expect(await screen.findByText("/docs/nope")).toBeInTheDocument();
    expect(document.querySelector("article.docs-article")).toBeNull();
  });

  it("flips documentElement between light and dark, which is how the globals.css tokens switch", async () => {
    const user = userEvent.setup();
    renderDocs("/docs/concepts/plans", "light");
    await screen.findByRole("heading", { level: 1, name: "Plans" });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: /Switch to dark theme/i }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(document.documentElement.classList.contains("light")).toBe(false);

    await user.click(screen.getByRole("button", { name: /Switch to system theme/i }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true);
    });
  });

  it("renders the language selector in the header and displays all 10 locales", async () => {
    const user = userEvent.setup();
    renderDocs("/docs/concepts/plans");
    await screen.findByRole("heading", { level: 1, name: "Plans" });

    const langTriggers = screen.getAllByRole("button", { name: "Choose language" });
    expect(langTriggers.length).toBeGreaterThanOrEqual(1);
    const headerTrigger = langTriggers[0];
    expect(headerTrigger).toHaveTextContent("English");

    await user.click(headerTrigger);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Deutsch")).toBeInTheDocument();
    expect(within(menu).getByText("日本語")).toBeInTheDocument();
    expect(within(menu).getByText("Español")).toBeInTheDocument();
    expect(within(menu).getByText("Français")).toBeInTheDocument();
    expect(within(menu).getByText("Português (Brasil)")).toBeInTheDocument();
    expect(within(menu).getByText("简体中文")).toBeInTheDocument();
    expect(within(menu).getByText("Русский")).toBeInTheDocument();
    expect(within(menu).getByText("Svenska")).toBeInTheDocument();
    expect(within(menu).getByText("हिन्दी")).toBeInTheDocument();
  });
});
