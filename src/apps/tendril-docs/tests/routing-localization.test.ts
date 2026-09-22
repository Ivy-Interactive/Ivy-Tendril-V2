import { describe, expect, it } from "vitest";
import { localizeNavTree, type NavSection } from "../src/lib/nav";
import { rewriteDocLinks } from "../src/lib/links";
import { routeForPath, contentPathForRoute } from "../src/lib/slug";
import { pageForRoute } from "../src/content";

describe("Routing localization", () => {
  const sampleNav: NavSection[] = [
    {
      name: "01_GettingStarted",
      title: "Getting Started",
      route: "/docs/gettingstarted",
      contentPath: "01_GettingStarted/_Index.md",
      groupExpanded: true,
      pages: [
        {
          title: "Introduction",
          route: "/docs/gettingstarted/introduction",
          contentPath: "01_GettingStarted/01_Introduction.md",
        },
      ],
      sections: [],
    },
    {
      name: "02_Concepts",
      title: "Concepts",
      route: "/docs/concepts",
      contentPath: "02_Concepts/_Index.md",
      groupExpanded: false,
      pages: [
        {
          title: "Plans",
          route: "/docs/concepts/plans",
          contentPath: "02_Concepts/01_Plans.md",
        },
      ],
      sections: [],
    },
  ];

  it("leaves nav tree unprefixed when localized for default English", () => {
    const enNav = localizeNavTree(sampleNav, "en");
    expect(enNav[0].route).toBe("/docs/gettingstarted");
    expect(enNav[0].pages[0].route).toBe("/docs/gettingstarted/introduction");
  });

  it("prefixes all section and page routes when localized for a target locale", () => {
    const deNav = localizeNavTree(sampleNav, "de");
    expect(deNav[0].route).toBe("/de/docs/gettingstarted");
    expect(deNav[0].pages[0].route).toBe("/de/docs/gettingstarted/introduction");
    expect(deNav[1].route).toBe("/de/docs/concepts");
    expect(deNav[1].pages[0].route).toBe("/de/docs/concepts/plans");
  });

  it("localizes section and page titles when lookupPage is provided", () => {
    const lookup = (route: string) => {
      if (route === "/de/docs/gettingstarted") return { title: "Erste Schritte" };
      if (route === "/de/docs/gettingstarted/introduction") return { title: "Einführung" };
      if (route === "/de/docs/concepts") return { title: "Konzepte" };
      if (route === "/de/docs/concepts/plans") return { title: "Pläne" };
      return undefined;
    };
    const deNav = localizeNavTree(sampleNav, "de", lookup);
    expect(deNav[0].title).toBe("Erste Schritte");
    expect(deNav[0].pages[0].title).toBe("Einführung");
    expect(deNav[1].title).toBe("Konzepte");
    expect(deNav[1].pages[0].title).toBe("Pläne");
  });

  it("falls back to authored titles when translated page is not in lookup", () => {
    const partialLookup = (route: string) => {
      if (route === "/es/docs/gettingstarted") return { title: "Primeros pasos" };
      return undefined;
    };
    const esNav = localizeNavTree(sampleNav, "es", partialLookup);
    expect(esNav[0].title).toBe("Primeros pasos");
    expect(esNav[0].pages[0].title).toBe("Introduction");
    expect(esNav[1].title).toBe("Concepts");
  });

  it("routeForPath supports optional locale parameter", () => {
    expect(routeForPath("01_GettingStarted/01_Introduction.md")).toBe(
      "/docs/gettingstarted/introduction",
    );
    expect(routeForPath("01_GettingStarted/01_Introduction.md", "en")).toBe(
      "/docs/gettingstarted/introduction",
    );
    expect(routeForPath("01_GettingStarted/01_Introduction.md", "de")).toBe(
      "/de/docs/gettingstarted/introduction",
    );
    expect(routeForPath("02_Concepts/_Index.md", "ja")).toBe("/ja/docs/concepts");
  });

  it("contentPathForRoute resolves both English and localized routes", () => {
    const paths = [
      "01_GettingStarted/_Index.md",
      "01_GettingStarted/01_Introduction.md",
      "02_Concepts/01_Plans.md",
    ];

    expect(contentPathForRoute("/docs/concepts/plans", paths)).toBe("02_Concepts/01_Plans.md");
    expect(contentPathForRoute("/de/docs/concepts/plans", paths)).toBe("02_Concepts/01_Plans.md");
    expect(contentPathForRoute("/ja/docs/gettingstarted/introduction", paths)).toBe(
      "01_GettingStarted/01_Introduction.md",
    );
  });

  it("pageForRoute resolves page model for both English and localized routes", () => {
    const enPage = pageForRoute("/docs/concepts/plans");
    expect(enPage).toBeDefined();
    expect(enPage?.title).toBe("Plans");

    const dePage = pageForRoute("/de/docs/concepts/plans");
    expect(dePage).toBeDefined();
    expect(dePage?.title).toBe("Plans");

    const jaIntro = pageForRoute("/ja/docs/gettingstarted/introduction");
    expect(jaIntro).toBeDefined();
    expect(["Welcome to Ivy Tendril", "Ivy Tendril へようこそ"]).toContain(jaIntro?.title);
  });

  it("rewriteDocLinks preserves active locale prefix in relative markdown links", () => {
    const body = "See [Plans](../02_Concepts/01_Plans.md#states) for details.";
    const rewrittenEn = rewriteDocLinks(
      body,
      "01_GettingStarted/01_Introduction.md",
      undefined,
      "en",
    );
    expect(rewrittenEn).toBe("See [Plans](/docs/concepts/plans#states) for details.");

    const rewrittenDe = rewriteDocLinks(
      body,
      "01_GettingStarted/01_Introduction.md",
      undefined,
      "de",
    );
    expect(rewrittenDe).toBe("See [Plans](/de/docs/concepts/plans#states) for details.");

    const rewrittenJa = rewriteDocLinks(
      body,
      "01_GettingStarted/01_Introduction.md",
      undefined,
      "ja",
    );
    expect(rewrittenJa).toBe("See [Plans](/ja/docs/concepts/plans#states) for details.");
  });
});
