import { describe, expect, it } from "vitest";
import {
  allRoutesForContent,
  routesForContent,
  shellPathForRoute,
} from "../src/plugins/emit-route-shells";
import { SITE_LOCALES } from "../src/config/locales.config";
import { CONTENT_DIR, readContent } from "./helpers";

const files = readContent();
const baseRoutes = routesForContent(CONTENT_DIR);
const allRoutes = allRoutesForContent(CONTENT_DIR);

describe("Static route shells localization", () => {
  it("emits base routes for every file and localized routes across all 10 locales", () => {
    expect(baseRoutes).toHaveLength(Object.keys(files).length);
    expect(allRoutes).toHaveLength(Object.keys(files).length * SITE_LOCALES.length);
  });

  it("maps localized routes to correct directory shells with root base '/'", () => {
    expect(shellPathForRoute("/docs/concepts/plans", "/")).toBe("docs/concepts/plans/index.html");
    expect(shellPathForRoute("/de/docs/concepts/plans", "/")).toBe(
      "de/docs/concepts/plans/index.html",
    );
    expect(shellPathForRoute("/ja/docs/gettingstarted/introduction", "/")).toBe(
      "ja/docs/gettingstarted/introduction/index.html",
    );
    expect(shellPathForRoute("/pt/docs/concepts", "/")).toBe("pt/docs/concepts/index.html");
    expect(shellPathForRoute("/zh/docs/concepts/plans", "/")).toBe(
      "zh/docs/concepts/plans/index.html",
    );
  });

  it("covers all 10 locales for every document in the site", () => {
    for (const locale of SITE_LOCALES) {
      const prefix = locale.code === "en" ? "/docs" : `/${locale.code}/docs`;
      const matching = allRoutes.filter((r) => r.startsWith(prefix));
      expect(matching).toHaveLength(baseRoutes.length);
    }
  });
});
