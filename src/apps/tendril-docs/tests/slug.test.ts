import { describe, expect, it } from "vitest";
import {
  ROUTE_BASE,
  contentPathForRoute,
  isSectionIndex,
  normalizeRoute,
  orderOf,
  routeForPath,
  slugify,
  slugifyHeading,
  stripOrder,
  titleFromName,
} from "../src/lib/slug";
import { readContent } from "./helpers";

describe("stripOrder", () => {
  it("removes a leading two-digit order prefix", () => {
    expect(stripOrder("02_Installation")).toBe("Installation");
    expect(stripOrder("001_Deep")).toBe("Deep");
  });

  it("leaves an unprefixed name alone", () => {
    expect(stripOrder("_Index")).toBe("_Index");
    expect(stripOrder("Installation")).toBe("Installation");
    expect(stripOrder("2_Installation")).toBe("2_Installation");
  });
});

describe("orderOf", () => {
  it("reads the prefix as a number and sorts unprefixed names last", () => {
    expect(orderOf("01_GettingStarted")).toBe(1);
    expect(orderOf("10_Reference")).toBe(10);
    expect(orderOf("Extras")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("slugify", () => {
  it("does not split camel case", () => {
    expect(slugify("01_GettingStarted")).toBe("gettingstarted");
    expect(slugify("Introduction")).toBe("introduction");
  });

  it("collapses runs of non-alphanumerics into single dashes", () => {
    expect(slugify("Model Providers")).toBe("model-providers");
    expect(slugify("CI / CD")).toBe("ci-cd");
    expect(slugify("_Index")).toBe("index");
  });
});

describe("routeForPath", () => {
  it("maps the README-facing paths to the routes the README links to", () => {
    expect(routeForPath("01_GettingStarted/01_Introduction.md")).toBe(
      "/docs/gettingstarted/introduction",
    );
    expect(routeForPath("02_Concepts/_Index.md")).toBe("/docs/concepts");
  });

  it("drops a section index segment and keeps nesting otherwise", () => {
    expect(routeForPath("01_GettingStarted/_Index.md")).toBe("/docs/gettingstarted");
    expect(routeForPath("02_Concepts/03_Lifecycle.md")).toBe("/docs/concepts/lifecycle");
    expect(routeForPath("03_Guides/01_Advanced/_Index.md")).toBe("/docs/guides/advanced");
  });

  it("tolerates Windows separators", () => {
    expect(routeForPath("02_Concepts\\01_Plans.md")).toBe("/docs/concepts/plans");
  });
});

describe("normalizeRoute", () => {
  it("strips trailing slashes, queries and fragments", () => {
    expect(normalizeRoute("/docs/concepts/")).toBe("/docs/concepts");
    expect(normalizeRoute("/docs/concepts/plans#plan-states")).toBe("/docs/concepts/plans");
    expect(normalizeRoute("/docs/concepts?q=1")).toBe("/docs/concepts");
    expect(normalizeRoute("/docs/")).toBe(ROUTE_BASE);
  });
});

describe("contentPathForRoute", () => {
  const contentPaths = Object.keys(readContent());

  it("round-trips every authored page", () => {
    expect(contentPaths.length).toBeGreaterThan(0);
    for (const contentPath of contentPaths) {
      expect(contentPathForRoute(routeForPath(contentPath), contentPaths)).toBe(contentPath);
    }
  });

  it("round-trips the README-facing routes", () => {
    expect(contentPathForRoute("/docs/gettingstarted/introduction", contentPaths)).toBe(
      "01_GettingStarted/01_Introduction.md",
    );
    expect(contentPathForRoute("/docs/concepts", contentPaths)).toBe("02_Concepts/_Index.md");
  });

  it("tolerates a trailing slash and returns undefined for an unknown route", () => {
    expect(contentPathForRoute("/docs/concepts/plans/", contentPaths)).toBe(
      "02_Concepts/01_Plans.md",
    );
    expect(contentPathForRoute("/docs/nope", contentPaths)).toBeUndefined();
  });
});

describe("isSectionIndex", () => {
  it("recognises only a trailing _Index.md", () => {
    expect(isSectionIndex("02_Concepts/_Index.md")).toBe(true);
    expect(isSectionIndex("02_Concepts/01_Plans.md")).toBe(false);
  });
});

describe("titleFromName", () => {
  it("de-slugs a folder or file name for the fallback title", () => {
    expect(titleFromName("01_GettingStarted")).toBe("Getting Started");
    expect(titleFromName("06_Troubleshooting.md")).toBe("Troubleshooting");
  });
});

describe("slugifyHeading", () => {
  it("matches what rehype-slug produces", () => {
    expect(slugifyHeading("Plan states")).toBe("plan-states");
    expect(slugifyHeading("Concurrency & worktrees")).toBe("concurrency--worktrees");
    expect(slugifyHeading("`config.yaml` keys")).toBe("configyaml-keys");
  });
});
