/**
 * The static-output contract.
 *
 * `vp build` emits one `index.html`; the `emitRouteShells` plugin copies it to `<route>/index.html`
 * for every route in the nav tree. If that route list ever drifts from the nav tree, deep links 404 on
 * a static host — so assert the list here rather than discovering it after a deploy. The build itself
 * is exercised by the `NpmBuild` verification and the CI `docs` job.
 */
import { describe, expect, it } from "vitest";
import { buildNavTree, flattenNavRoutes } from "../src/lib/nav";
import {
  readContentFiles,
  routesForContent,
  shellPathForRoute,
} from "../src/plugins/emit-route-shells";
import { ROUTE_BASE, routeForPath } from "../src/lib/slug";
import { CONTENT_DIR, readContent } from "./helpers";

const BASE = `${ROUTE_BASE}/`;
const files = readContent();
const routes = routesForContent(CONTENT_DIR);

describe("readContentFiles", () => {
  it("reads the same record the browser's import.meta.glob produces", () => {
    expect(Object.keys(readContentFiles(CONTENT_DIR)).sort()).toEqual(Object.keys(files).sort());
    for (const raw of Object.values(files)) {
      expect(raw.startsWith("---")).toBe(true);
    }
  });
});

describe("routesForContent", () => {
  it("is exactly the nav tree's route list", () => {
    expect(routes).toEqual(flattenNavRoutes(buildNavTree(files)));
  });

  it("covers every authored page, including both section indexes", () => {
    const expected = Object.keys(files).map(routeForPath);
    expect([...routes].sort()).toEqual([...expected].sort());
    expect(routes).toContain("/docs/gettingstarted");
    expect(routes).toContain("/docs/concepts");
    expect(routes).toHaveLength(Object.keys(files).length);
  });
});

describe("shellPathForRoute", () => {
  it("emits a shell for every route except the base itself", () => {
    const shells = routes.map((route) => shellPathForRoute(route, BASE));
    expect(shells.every((shell) => shell === undefined || shell.endsWith("/index.html"))).toBe(
      true,
    );
    expect(shells.filter((shell) => shell !== undefined)).toHaveLength(routes.length);
    expect(new Set(shells).size).toBe(shells.length);
  });

  it("maps a route to its directory index", () => {
    expect(shellPathForRoute("/docs/concepts", BASE)).toBe("concepts/index.html");
    expect(shellPathForRoute("/docs/concepts/plans", BASE)).toBe("concepts/plans/index.html");
    expect(shellPathForRoute("/docs/gettingstarted/introduction", BASE)).toBe(
      "gettingstarted/introduction/index.html",
    );
  });

  it("leaves the base route to the build's own index.html", () => {
    expect(shellPathForRoute(ROUTE_BASE, BASE)).toBeUndefined();
  });

  it("ignores a route outside the base", () => {
    expect(shellPathForRoute("/elsewhere/page", BASE)).toBeUndefined();
  });

  it("tolerates a base without a trailing slash", () => {
    expect(shellPathForRoute("/docs/concepts/plans", ROUTE_BASE)).toBe("concepts/plans/index.html");
  });

  it("supports root base path", () => {
    expect(shellPathForRoute("/docs/concepts/plans", "/")).toBe("docs/concepts/plans/index.html");
    expect(shellPathForRoute("/docs/gettingstarted/introduction", "/")).toBe(
      "docs/gettingstarted/introduction/index.html",
    );
  });
});
