import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DialogShell } from "@ivy-interactive/components/tendril";
import { RecommendationNoteDialog } from "../src/components/RecommendationNoteDialog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distAssetsDir = path.join(repoRoot, "dist", "assets");
const distIndexHtml = path.join(repoRoot, "dist", "index.html");

/** Mirrors `code-splitting.test.tsx`'s self-healing build check: `dist/` is a build artifact
 * vitest never produces itself, so a fresh worktree rebuilds it here rather than depending on a
 * prior `pnpm build`. Kept independent of that file's own `beforeAll` since vitest gives each
 * test file its own module scope. */
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
    newestMtimeUnder(path.join(repoRoot, "..", "..", "packages/components/src")),
    fs.statSync(path.join(repoRoot, "index.html")).mtimeMs,
    fs.statSync(path.join(repoRoot, "vite.config.ts")).mtimeMs,
  ];
  return Math.max(...inputMtimes) > distMtime;
}

beforeAll(() => {
  if (!distIsMissingOrStale()) return;
  try {
    // `NODE_ENV: "production"` for the same reason `code-splitting.test.tsx` passes it, and it
    // matters more here than there: whichever of the two hooks finds `dist/` stale first is the one
    // that builds, and the other then measures whatever it left behind. Without this, a stale `dist`
    // in a full-suite run is rebuilt by *this* hook, inheriting vitest's `NODE_ENV=test`, which
    // resolves React to its development build - `vendor-react` comes out 392,082 bytes instead of
    // 189,604 and code-splitting's eager budget fails by ~155 kB on a tree that did not grow.
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

function readBuiltCss(): string {
  if (buildError !== null || distIsMissingOrStale()) {
    throw new Error(
      "dist/ is missing or stale relative to vite.config.ts - run pnpm build" +
        (buildError ? ` (automatic rebuild in beforeAll also failed: ${buildError})` : ""),
    );
  }
  const cssFile = fs.readdirSync(distAssetsDir).find((file) => file.endsWith(".css"));
  expect(cssFile, "expected a built CSS file in dist/assets").toBeDefined();
  return fs.readFileSync(path.join(distAssetsDir, cssFile!), "utf8");
}

describe("Tailwind utilities emitted from @ivy-interactive/components", () => {
  it("emits the arbitrary-value utilities DialogContent and Sheet rely on", () => {
    const css = readBuiltCss();

    // Selectors as Tailwind v4 escapes them in the generated stylesheet.
    const requiredSelectors = [
      ".left-\\[50\\%\\]",
      ".top-\\[10\\%\\]",
      ".translate-x-\\[-50\\%\\]",
      ".max-h-\\[85vh\\]",
      ".inset-y-0",
    ];

    for (const selector of requiredSelectors) {
      expect(css.includes(selector), `expected ${selector} in the built stylesheet`).toBe(true);
    }
  });

  it("mounts DialogShell with the positioning utilities on its content element", () => {
    render(
      <DialogShell
        isOpen={true}
        onClose={() => {}}
        title="Test Dialog"
        testId="tailwind-check-dialog"
        footer={<button type="button">Close</button>}
      >
        <p>Body</p>
      </DialogShell>,
    );

    const dialog = screen.getByRole("dialog");
    for (const className of ["fixed", "left-[50%]", "top-[10%]", "translate-x-[-50%]"]) {
      expect(dialog.className, `expected "${className}" on the dialog content element`).toContain(
        className,
      );
    }
  });

  it("mounts RecommendationNoteDialog on-screen within DialogShell, preserving its accessible roles and test IDs", () => {
    render(
      <RecommendationNoteDialog
        isOpen={true}
        title="Automate Workflows"
        action="Accept"
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-testid", "recommendation-note-dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Accept Recommendation");
    for (const className of ["fixed", "left-[50%]", "top-[10%]"]) {
      expect(dialog.className).toContain(className);
    }

    expect(screen.getByTestId("rec-dialog-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("rec-dialog-submit")).toBeInTheDocument();
  });
});
