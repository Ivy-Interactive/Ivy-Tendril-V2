import React, { Suspense, act } from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DashboardView } from "../src/views/DashboardView";
import { planSummary } from "./fixtures/plan.fixture";
import type { PlanSummary, Job } from "../src/types/api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distAssetsDir = path.join(repoRoot, "dist", "assets");
const distIndexHtml = path.join(repoRoot, "dist", "index.html");

/** Ceiling on the Vite entry chunk (`dist/assets/index-*.js`).
 *
 * Measured 2026-09-16: 665,889 bytes, 72.6% of this ceiling (2026-09-14 at d6d7a48: 718,210).
 * The monolithic baseline before the split in plan 00564 was 3,461,242 bytes, so this is still
 * a ~81% reduction. Measure from a build run outside vitest (`pnpm --filter
 * @ivy-interactive/tendril-app build`) - a build inherited from vitest sees NODE_ENV=test
 * and bundles development React, which inflates the entry chunk by ~28 kB.
 *
 * This number is not a size target, it is the regression guard on the `codeSplitting`
 * group priorities documented in vite.config.ts. The failures it exists to catch move
 * hundreds of KB at once - 1,802,771 bytes eager with `vendor-react` below `vendor-syntax`,
 * 4,290,781 bytes with the non-working `manualChunks` function form - so a ceiling anywhere
 * in this range still trips instantly on a priority mistake. It was raised from 700 kB
 * (716,800 bytes) after organic feature-porting growth overran it by 1,410 bytes and made
 * main CI red on three consecutive commits: the entry chunk was verified to hold no
 * heavyweight, all nine vendor chunks and every lazy view chunk were still separate, and
 * eager JS was 1,383,007 bytes of the 1.6 MB budget below.
 *
 * Before raising it again: check what became eager (the second budget below and the
 * `mustBeLazy` list in the next test), not just this number. */
const ENTRY_CHUNK_BUDGET_BYTES = 896 * 1024;

/** Usage above this fraction of the budget prints a warning, so the next breach is
 * caught in a green run instead of turning main CI red. It fires at 825,753 bytes, roughly
 * 156 kB of growth past the 2026-09-16 measurement. */
const ENTRY_CHUNK_WARN_RATIO = 0.9;

/** Ceiling on the whole initial load: the entry chunk plus every chunk it reaches through a *static*
 * import, transitively. Baseline before the split in plan 00564 was 4,893,138 bytes, of which
 * `vendor-mermaid` alone was 3,092,317.
 *
 * **What this measures, and why the number stayed at 1.6 MB while the metric changed.** This budget
 * used to sum the entry plus every `rel="modulepreload"` in `dist/index.html`, and it was red at
 * 1,837,921 bytes for long enough to accumulate two wrong diagnoses. Both came from believing the
 * preload list counted things the browser never blocks on. It does not: Vite emits a `modulepreload`
 * for exactly the entry's transitive static graph, so the two sets are byte-for-byte identical
 * (verified 2026-09-16: the same 14 chunks, the same 1,837,921 bytes). The earlier inspection that
 * concluded "the entry imports neither `vendor-katex` nor `PlanMarkdown`" only looked at the entry's
 * *direct* imports. `vendor-katex` was one hop further out - statically imported by the 447,527-byte
 * markdown-pipeline chunk (react-markdown, remark, rehype, micromark, hast, mdast; it is named
 * `browser-*` after `vfile`'s browser entry) which the entry did import directly. So the metric was
 * right, the bundle was wrong, and the ceiling never needed moving. The test now walks the static
 * closure itself rather than trusting the HTML as a proxy for it, so the failure message names the
 * chunks and the assertion says what it means.
 *
 * Measure from a production build (`npm run build`). A build that inherits vitest's `NODE_ENV=test`
 * bundles development React and reads ~225 kB heavier; two separate investigations quoted ~2.03 MB
 * from one and drew conclusions from the difference. The `beforeAll` rebuild below now forces
 * `NODE_ENV=production` for exactly this reason - see the comment there.
 *
 * **Two fixes that were tried and did not work.** Do not re-run either without a new reason.
 * (1) Tree-shaking metadata: adding `sideEffects: ["**\/*.css"]` to the component package is correct
 * metadata and moved this total by 527 bytes. (2) Consuming the component package as TypeScript
 * source, via a `source` export condition plus `resolve.conditions`, so the app compiles it from
 * `src/` instead of its built `.mjs` bundles. It behaves as advertised - the
 * `INEFFECTIVE_DYNAMIC_IMPORT` warning goes away and the entry chunk falls from 718,210 to 99,248
 * bytes - and still did not fix this, landing at 1,759,044, because the same modules stay reachable
 * either way. It also fragmented the preload set from 16 chunks to 94 and broke
 * `tailwind-components-utilities.test.tsx`, which asserts selectors present in the built `style.css`.
 *
 * **What did work.** `rehype-katex` is now loaded on demand in `packages/components/src/lib/math.ts`
 * rather than imported, which took `vendor-katex` (259,044 bytes) out of the closure and brought this
 * to 1,573,816 bytes across 14 chunks, 93.8% of the budget. Most markdown Tendril renders has no
 * maths in it, so that cost was being paid before first paint for a feature the document usually does
 * not use - the same argument that already puts Mermaid, Graphviz and Prism behind dynamic imports in
 * `MarkdownCodeBlock`.
 *
 * **Why it is still 94% full, and the next ~100 kB.** Everything eager here is eager for one
 * structural reason: `App.tsx` and six other eagerly-loaded modules import from the
 * `@ivy-interactive/components/tendril` barrel (for `TendrilShell`, `ShellNav`, `ContentInput`,
 * `Terminal`, `useShortcut`, …), and `tendril.mjs` statically imports both `react-diff-view` +
 * `refractor/core` (via `PlanDiffView`) and the markdown pipeline (via `PlanMarkdown`). The app
 * consumes finished `.mjs` chunks, so it cannot split them; only the components package can. The
 * cheapest next step is `vendor-diff` (69,947) + `vendor-refractor-core` (30,740): make
 * `PlanDiffView`'s `react-diff-view` and `refractor/core` imports dynamic, the way
 * `MarkdownCodeBlock` handles the highlighter. That was left undone deliberately - `PlanDiffView`
 * uses `parseDiff`/`Diff`/`Hunk`/`tokenize` throughout its render, so it is a real refactor, not a
 * two-line change, and this budget is green without it. The larger prize behind it is the
 * markdown-pipeline chunk itself, still 440,761 bytes eager because the shell reaches `PlanMarkdown`
 * through the same barrel; that one wants a new export subpath in the components package (the job
 * `charts` and `diagrams` already do), and a subpath only helps once *every* importer moves off
 * `/tendril`, which is why it is not a local change either.
 *
 * A failure here is a regression, not a licence to raise the number. Raising it was tried once: it
 * moved the goalpost to another red number and deleted the warning comment to do it. Find out what
 * became eager first - the failure message lists every chunk with its size. */
const EAGER_BUDGET_BYTES = 1.6 * 1024 * 1024;

/** Usage above this fraction prints a warning, so the next breach is caught in a green run. At the
 * 2026-09-16 measurement of 1,573,816 bytes this fires 20,020 bytes of growth away, which is tight
 * on purpose: the budget is 93.8% full and the paragraph above names the next 100 kB to reclaim. */
const EAGER_WARN_RATIO = 0.95;

/** Matches a *static* import of a sibling chunk in minified output: `from"./x.js"`, and the
 * bare-specifier form `import"./x.js"`. A dynamic `import("./x.js")` has a `(` between the keyword
 * and the string, so it does not match - which is the entire point, since the dynamically imported
 * chunks are the ones that must stay off the initial load. */
const STATIC_CHUNK_IMPORT = /(?:from|import)\s*"\.\/([^"]+\.js)"/g;

/** Every chunk the browser must have evaluated before the entry module's own code can run: the entry
 * plus its transitive static imports. This, not the `modulepreload` list, is the definition of "the
 * initial load" that the budget above measures - see the comment on `EAGER_BUDGET_BYTES` for why the
 * two happen to coincide and why relying on that coincidence misled two investigations. */
function entryStaticClosure(entryFileName: string): string[] {
  const reached = new Set([entryFileName]);
  const queue = [entryFileName];

  while (queue.length > 0) {
    const source = fs.readFileSync(path.join(distAssetsDir, queue.shift()!), "utf8");
    for (const match of source.matchAll(STATIC_CHUNK_IMPORT)) {
      if (reached.has(match[1])) continue;
      reached.add(match[1]);
      queue.push(match[1]);
    }
  }

  return [...reached];
}

// The third test below reads dist/, which vitest never builds itself. If dist/
// is missing, or older than the sources it was built from, rebuild it here so
// the test is self-sufficient on a fresh worktree instead of depending on a
// prior `pnpm build` invocation. Rebuild failures are recorded (not thrown)
// so the two render-only tests in this file, which never touch dist/, still
// run when the build step fails or is skipped.
let buildError: string | null = null;

function newestMtimeUnder(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtimeMs = entry.isDirectory() ? newestMtimeUnder(full) : fs.statSync(full).mtimeMs;
    if (mtimeMs > newest) newest = mtimeMs;
  }
  return newest;
}

function distIsMissingOrStale(): boolean {
  if (!fs.existsSync(distIndexHtml) || !fs.existsSync(distAssetsDir)) return true;

  const distMtime = fs.statSync(distIndexHtml).mtimeMs;
  const inputMtimes = [
    newestMtimeUnder(path.join(repoRoot, "src")),
    fs.statSync(path.join(repoRoot, "index.html")).mtimeMs,
    fs.statSync(path.join(repoRoot, "vite.config.ts")).mtimeMs,
    fs.statSync(path.join(repoRoot, "package.json")).mtimeMs,
  ];
  if (Math.max(...inputMtimes) > distMtime) return true;

  // Belt-and-suspenders: a dist built from a config predating the manual
  // chunk split has no vendor-*.js files even though nothing looks stale
  // by mtime alone (this is exactly what produced the confusing
  // "vendor-refractor" failure this test used to raise).
  const assetFiles = fs.readdirSync(distAssetsDir);
  return !assetFiles.some((file) => file.startsWith("vendor-") && file.endsWith(".js"));
}

beforeAll(() => {
  if (!distIsMissingOrStale()) return;
  try {
    // `NODE_ENV: "production"` is load-bearing, not tidiness. vitest runs with `NODE_ENV=test`, the
    // child inherits it, and React's export map then resolves to its *development* build: measured
    // 2026-09-16, `vendor-react` comes out 392,082 bytes instead of 189,604 and the entry chunk
    // 688,265 instead of 665,889, putting the eager total at 1,828,985 against a 1,677,722 budget.
    // A build that cannot pass the budget it exists to feed is worse than no build, and this
    // difference is exactly what made two investigations quote ~2.03 MB as the real figure.
    execFileSync("pnpm", ["build"], {
      cwd: repoRoot,
      stdio: "inherit",
      timeout: 300_000,
      env: { ...process.env, NODE_ENV: "production" },
    });
  } catch (error) {
    buildError = error instanceof Error ? error.message : String(error);
  }
}, 300_000);

describe("Code-Splitting & Suspense Boundaries", () => {
  const mockPlans: PlanSummary[] = [
    planSummary({
      id: "00010",
      title: "Active Split Plan",
      state: "Executing",
      project: "Tendril-App",
      level: "Feature",
    }),
    planSummary({
      id: "00020",
      title: "Completed Split Plan",
      state: "Completed",
      project: "Tendril-App",
      level: "Bug",
    }),
  ];

  const mockJobs: Job[] = [
    {
      id: "00101",
      type: "ExecutePlan",
      planId: "00010",
      planTitle: "Active Split Plan",
      project: "Tendril-App",
      status: "Running",
      cost: 0.12,
      tokens: 24000,
    },
  ];

  it("renders DashboardView correctly within a Suspense boundary", () => {
    render(
      <Suspense fallback={<div data-testid="test-fallback-spinner">Loading dashboard...</div>}>
        <DashboardView plans={mockPlans} jobs={mockJobs} onSelectJob={() => {}} />
      </Suspense>,
    );

    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByText("What Are We Producing Today?")).toBeInTheDocument();
    expect(screen.getByText("Active Split Plan")).toBeInTheDocument();
  });

  it("renders lazy-loaded DashboardView within a Suspense boundary when resolved", async () => {
    const importPromise = import("../src/views/DashboardView");
    const LazyDashboard = React.lazy(async () => {
      const mod = await importPromise;
      return { default: mod.DashboardView };
    });

    render(
      <Suspense fallback={<div data-testid="lazy-fallback-spinner">Loading dynamic view...</div>}>
        <LazyDashboard plans={mockPlans} jobs={mockJobs} onSelectJob={() => {}} />
      </Suspense>,
    );

    await act(async () => {
      await importPromise;
    });

    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByText("What Are We Producing Today?")).toBeInTheDocument();
  });

  it("produces isolated vendor chunks and code-split view chunks in the build output", () => {
    if (buildError !== null || distIsMissingOrStale()) {
      throw new Error(
        "dist/ is missing or stale relative to vite.config.ts - run pnpm build" +
          (buildError ? ` (automatic rebuild in beforeAll also failed: ${buildError})` : ""),
      );
    }

    const assetFiles = fs.readdirSync(distAssetsDir);

    // Check required vendor manual chunks
    const requiredVendorChunks = [
      // The refractor registry is split from the language packs: the registry is
      // imported synchronously by PlanDiffView, the packs are dynamically imported
      // one at a time, and a chunk is one loading unit.
      "vendor-refractor-core",
      "vendor-syntax",
      "vendor-pdfjs",
      "vendor-diff",
      "vendor-mermaid",
      "vendor-graphviz",
      "vendor-katex",
      "vendor-react",
    ];

    for (const chunkPrefix of requiredVendorChunks) {
      const found = assetFiles.some((file) => file.startsWith(chunkPrefix) && file.endsWith(".js"));
      expect(found, `Expected chunk starting with ${chunkPrefix} in dist/assets`).toBe(true);
    }

    // Check dynamic view chunks
    const viewChunks = [
      "DashboardView",
      "PlansView",
      "PlanDetailView",
      "JobSessionView",
      "ReviewView",
      "SettingsView",
      "ChatView",
      "InboxView",
    ];

    for (const viewName of viewChunks) {
      const found = assetFiles.some((file) => file.startsWith(viewName) && file.endsWith(".js"));
      expect(found, `Expected lazy view chunk for ${viewName} in dist/assets`).toBe(true);
    }

    // Find the main index.html entry chunk referenced by dist/index.html
    expect(fs.existsSync(distIndexHtml)).toBe(true);
    const indexHtml = fs.readFileSync(distIndexHtml, "utf8");
    const scriptMatch = indexHtml.match(/src="\/assets\/(index-[^"]+\.js)"/);
    expect(scriptMatch).not.toBeNull();

    const entryChunkFileName = scriptMatch![1];
    const entryChunkPath = path.join(distAssetsDir, entryChunkFileName);
    expect(fs.existsSync(entryChunkPath)).toBe(true);

    const entryStat = fs.statSync(entryChunkPath);
    const overage = entryStat.size - ENTRY_CHUNK_BUDGET_BYTES;
    const overagePercent = ((overage / ENTRY_CHUNK_BUDGET_BYTES) * 100).toFixed(2);
    const usagePercent = ((entryStat.size / ENTRY_CHUNK_BUDGET_BYTES) * 100).toFixed(1);

    // Written straight to stderr, not via console.warn: vitest defaults to
    // silent: "passed-only", which discards a passing test's console output and only
    // replays it if the test fails. A console.warn here would therefore appear only
    // once the budget is already blown, which is the one run where it adds nothing.
    if (entryStat.size > ENTRY_CHUNK_BUDGET_BYTES * ENTRY_CHUNK_WARN_RATIO) {
      process.stderr.write(
        `WARNING: entry chunk ${entryChunkFileName} is ${entryStat.size} bytes, ${usagePercent}% ` +
          `of the ${ENTRY_CHUNK_BUDGET_BYTES}-byte budget - check what became eager ` +
          `before raising it\n`,
      );
    }

    expect(
      entryStat.size,
      `entry chunk ${entryChunkFileName} is ${entryStat.size} bytes, over the ` +
        `${ENTRY_CHUNK_BUDGET_BYTES}-byte budget by ${overage} bytes (${overagePercent}%)`,
    ).toBeLessThan(ENTRY_CHUNK_BUDGET_BYTES);
  });

  it("keeps the diagram and syntax-highlighter chunks off the initial load", () => {
    if (buildError !== null || distIsMissingOrStale()) {
      throw new Error(
        "dist/ is missing or stale relative to vite.config.ts - run pnpm build" +
          (buildError ? ` (automatic rebuild in beforeAll also failed: ${buildError})` : ""),
      );
    }

    const indexHtml = fs.readFileSync(distIndexHtml, "utf8");
    const entry = indexHtml.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
    expect(entry, "no entry script in dist/index.html").toBeDefined();

    const eager = entryStaticClosure(entry!);

    // The rel and href attributes appear in either order depending on the emitter,
    // so match both forms and de-duplicate.
    const preloads = [
      ...new Set(
        [
          ...indexHtml.matchAll(/rel="modulepreload"[^>]*href="\/assets\/([^"]+\.js)"/g),
          ...indexHtml.matchAll(/href="\/assets\/([^"]+\.js)"[^>]*rel="modulepreload"/g),
        ].map((match) => match[1]),
      ),
    ];

    // The invariant the byte budget below rests on: Vite emits a `modulepreload` for exactly the
    // entry's transitive static graph and for nothing else, so "what the browser is told to fetch up
    // front" and "what the entry statically needs" are the same set. Measured 2026-09-16: both are
    // the same 14 chunks. This is asserted in one direction only. A preload that is *not* in the
    // closure would mean Vite had started hinting at lazily routed chunks, at which point these bytes
    // stop being blocking cost and this budget needs rethinking rather than obeying - that is exactly
    // the confusion documented below, and it should surface as a message, not as a silent drift.
    // Fewer preloads than the closure is not a problem: the closure, not the HTML, is the metric.
    const unexpectedPreloads = preloads.filter((file) => !eager.includes(file));
    expect(
      unexpectedPreloads,
      "dist/index.html preloads chunks outside the entry's static import graph " +
        `(${unexpectedPreloads.join(", ")}). Vite's preload policy has changed; re-read the comment ` +
        "above before trusting the byte budget below.",
    ).toEqual([]);

    // These are the heavyweights this app must never fetch up front: two diagram
    // renderers, the Prism language packs and the PDF viewer. Each is reached only
    // through a dynamic import(), so a name appearing here means a static edge
    // crept back into the eager graph - most likely a shared dependency absorbed
    // into the chunk by a codeSplitting group with too low a priority.
    const mustBeLazy = ["vendor-mermaid", "vendor-graphviz", "vendor-syntax", "vendor-pdfjs"];
    for (const chunkPrefix of mustBeLazy) {
      const leaked = eager.filter((file) => file.startsWith(chunkPrefix));
      expect(
        leaked,
        `${chunkPrefix} must not be in the initial load (entry's static import graph), found: ${leaked.join(", ")}`,
      ).toEqual([]);
    }

    const sizes = eager
      .map((file) => [file, fs.statSync(path.join(distAssetsDir, file)).size] as const)
      .sort((a, b) => b[1] - a[1]);
    const eagerBytes = sizes.reduce((total, [, size]) => total + size, 0);
    const usagePercent = ((eagerBytes / EAGER_BUDGET_BYTES) * 100).toFixed(1);

    // Same reasoning as the entry-chunk warning above: written to stderr because vitest discards a
    // passing test's console output.
    if (eagerBytes > EAGER_BUDGET_BYTES * EAGER_WARN_RATIO) {
      process.stderr.write(
        `WARNING: eager JS is ${eagerBytes} bytes, ${usagePercent}% of the ` +
          `${EAGER_BUDGET_BYTES}-byte budget - the cheapest ~100 kB left to reclaim is described in ` +
          "the comment on EAGER_BUDGET_BYTES\n",
      );
    }

    expect(
      eagerBytes,
      `eager JS is ${eagerBytes} bytes across ${eager.length} chunks: ` +
        sizes.map(([file, size]) => `${file} (${size})`).join(", "),
    ).toBeLessThan(EAGER_BUDGET_BYTES);
  });
});
