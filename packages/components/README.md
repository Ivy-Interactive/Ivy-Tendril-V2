# components-storybook

> Comprehensive UI component library, renderers, and Tendril widgets showcase with Storybook.

[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue)](https://www.typescriptlang.org/)
[![Vite+](https://img.shields.io/badge/Vite+-0.3-646CFF)](https://github.com/voidzero/vite-plus)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1-38B2AC)](https://tailwindcss.com/)
[![Storybook](https://img.shields.io/badge/Storybook-8.6-FF4785)](https://storybook.js.org/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB)](https://react.dev/)

## Architecture & Subpath Exports

`components-storybook` is structured with modular subpath exports, enabling consumers to import targeted subsets of the library without unnecessary dependencies:

- **`components-storybook`** — Root entry for common components, utilities, and theme provider
- **`components-storybook/ui`** — 38+ Radix UI & shadcn/ui primitives (Button, Input, Card, Dialog, etc.)
- **`components-storybook/renderers`** — Rich content renderers (Markdown, JSON, XML, HTML, Code, Chat, ErrorBoundary)
- **`components-storybook/diagrams`** — Diagram renderers (Mermaid, Graphviz) that lazy-load mermaid and @hpcc-js/wasm-graphviz on first render
- **`components-storybook/tendril`** — Tendril execution widgets, Shell layout, diff inspection, and dashboard analytics
- **`components-storybook/styles/*`** — Design system tokens and stylesheets (`index.css`, `markdown-spacing.css`)

## Installation

Install with your preferred package manager:

```bash
pnpm add components-storybook
# or
npm install components-storybook
# or
yarn add components-storybook
# or
vp install components-storybook
```

## Setup

Import the CSS stylesheet in your application entry point:

```css
@import "components-storybook/styles/index.css";
```

Or in JavaScript/TypeScript:

```ts
import "components-storybook/styles/index.css";
```

## Usage Examples

### 1. Root Import & Theme Provider

```tsx
import { ThemeProvider, useTheme, Button, Card } from "components-storybook";

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="app-theme">
      <Card>
        <Button>Hello World</Button>
      </Card>
    </ThemeProvider>
  );
}
```

### 2. UI Primitives

```tsx
import {
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  Card,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Input,
  cn,
} from "components-storybook/ui";

function DemoComponent() {
  return (
    <div className={cn("space-y-4 p-4")}>
      <Button variant="default" size="lg">
        Primary Action
      </Button>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <h2>Dialog Content</h2>
          <p>Your content here</p>
        </DialogContent>
      </Dialog>

      <Card>
        <Badge variant="secondary">Status</Badge>
        <Input placeholder="Enter text..." />
      </Card>

      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Tab 1 Content</TabsContent>
        <TabsContent value="tab2">Tab 2 Content</TabsContent>
      </Tabs>
    </div>
  );
}
```

### 3. Rich Content Renderers

```tsx
import { MarkdownRenderer, JsonRenderer } from "components-storybook/renderers";
import { MermaidRenderer, GraphvizRenderer } from "components-storybook/diagrams";

function ContentDemo() {
  const markdownContent = "# Hello\n\nThis is **Markdown** content.";
  const mermaidDiagram = "graph TD; A-->B; B-->C;";
  const dotGraph = "digraph G { A -> B -> C; }";
  const jsonData = { name: "Example", value: 42 };

  return (
    <div className="space-y-6">
      <MarkdownRenderer content={markdownContent} />
      <MermaidRenderer content={mermaidDiagram} />
      <GraphvizRenderer content={dotGraph} />
      <JsonRenderer data={jsonData} />
    </div>
  );
}
```

### 4. Tendril Widgets

```tsx
import {
  TendrilShell,
  AgentViewer,
  PlanMarkdown,
  TendrilDashboard,
  ContentInput,
  BadgeSelect,
} from "components-storybook/tendril";

function TendrilApp() {
  const dashboardData = {
    kpis: [
      { label: "Plans", value: 42, trend: "up", change: 12 },
      { label: "Jobs", value: 128, trend: "up", change: 8 },
    ],
    activity: [],
    jobs: [],
    trends: [],
  };

  return (
    <TendrilShell
      navItems={[
        { id: "plans", label: "Plans", icon: "folder", href: "/plans" },
        { id: "jobs", label: "Jobs", icon: "activity", href: "/jobs" },
      ]}
      tabs={[{ id: "overview", label: "Overview", path: "/" }]}
    >
      <div className="space-y-6">
        <TendrilDashboard {...dashboardData} />

        <AgentViewer events={[]} isStreaming={false} />

        <PlanMarkdown content="# Plan Title\n\nPlan description." />

        <ContentInput
          onSubmit={(text) => console.log("Submitted:", text)}
          placeholder="Enter your prompt..."
        />

        <BadgeSelect
          options={[
            { value: "feature", label: "Feature" },
            { value: "bug", label: "Bug" },
          ]}
          value="feature"
          onChange={(value) => console.log("Selected:", value)}
        />
      </div>
    </TendrilShell>
  );
}
```

## Tendril Consumer Integration & Setup

`components-storybook` serves as a core UI dependency for `SpaceCorps/Tendril-App` (a desktop Rust and Tauri application).

### 1. Stylesheet Import

Import the standalone compiled CSS bundle at the root of your application:

```ts
import "@spacecorps/components-storybook/style.css";
```

This single stylesheet includes compiled design system tokens, Tailwind CSS utility classes, `@layer base` styles, and component CSS rules.

### 2. Tendril Entrypoint

Import Tendril widgets directly from the `./tendril` subpath:

```tsx
import {
  TendrilShell,
  PlanMarkdown,
  PlanDiffView,
  AgentViewer,
  TendrilProcessViewer,
  ContentInput,
  BadgeSelect,
  SortableVerificationList,
  TendrilDashboard,
} from "@spacecorps/components-storybook/tendril";
```

### 3. Font Setup

The design system uses Geist Sans (`--font-sans`) and Geist Mono (`--font-mono`). Consumer applications can either:

1. Install variable fonts as dependencies:
   ```bash
   pnpm add @fontsource-variable/geist @fontsource-variable/geist-mono
   ```
   and import them in the application entry point:
   ```ts
   import "@fontsource-variable/geist";
   import "@fontsource-variable/geist-mono";
   ```
2. Rely on system fallback fonts (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` for sans, `ui-monospace, monospace` for mono).

### 4. Tauri WebView Compatibility and Safe Navigation

When embedding in desktop webviews (such as Tauri), clicking external links should not navigate the desktop container away from the application.

`PlanMarkdown` provides idiomatic React callback props:

- `onLinkClick?: (href: string, event: React.MouseEvent) => void;`: Intercepts link clicks. When omitted, external links (`http://`, `https://`) automatically open via `window.open(href, "_blank", "noopener,noreferrer")` to protect the desktop webview container.
- `onFileClick?: (filePath: string, event: React.MouseEvent) => void;`: Intercepts local filesystem (`file://`) link clicks for desktop integration (such as opening the file in an external editor or revealing in the OS file explorer). When omitted and `dangerouslyAllowLocalFiles` is false, local file links render as non-navigating text elements.

### 5. Private CI & Artifact Consumption

For reproducible consumption in private CI environments:

- Build and pack release tarballs via `pnpm pack`.
- Attach the generated `.tgz` archive to GitHub Releases or consume via tarball URL in `Tendril-App`.
- This ensures reproducible builds without committing private tokens or registry credentials.

## Storybook Catalog Showcase

This project includes a comprehensive Storybook catalog showcasing all components with interactive examples and documentation.

### Interactive Development

Launch the Storybook development server:

```bash
pnpm run storybook
# or
vp run storybook
```

Navigate to `http://127.0.0.1:6006` to explore the component catalog. When 6006 is already taken the
server steps to the next free port in 6006..6015, and either way the chosen URL is printed on startup
before Storybook boots. Override the range with `STORYBOOK_PORT_BASE`, or pass an exact port through
with `pnpm run storybook -- -p 7777`.

### Production Static Build

Build a production-ready static Storybook site:

```bash
pnpm run storybook:build
# or
vp run storybook:build
```

Output directory: `dist-storybook/`

### Static Preview

Preview the production Storybook build locally:

```bash
pnpm run storybook:preview
# or
vp run storybook:preview
```

### Visual Catalog Structure

The Storybook catalog is organized into the following sections:

- **Foundation** — Theme provider, typography, design tokens
- **UI Primitives** — All 38+ base components with variants and states
- **Renderers** — Content rendering components (Markdown, Mermaid, Graphviz, JSON, XML, HTML)
- **Tendril Shell** — Navigation, tabs, sidebar components
- **Tendril Widgets** — Agent viewer, plan markdown, diff view, dashboard, web viewer
- **Inputs & Controls** — ContentInput, BadgeSelect, SortableVerificationList
- **Specialized Components** — Chat bubbles, error boundaries, loading states

### Storybook Testing

Install Playwright browser binaries (one-time setup):

```bash
pnpm run test-storybook:install
```

Browser binaries are cached in `~/.cache/ms-playwright` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright` (Windows) and are not re-downloaded per clone.

Run Storybook tests against a running dev server:

```bash
pnpm run test-storybook
```

Run Storybook tests in CI mode (builds static files first):

```bash
pnpm run test-storybook:ci
```

#### Accessibility testing

Accessibility audits run automatically via `@storybook/addon-a11y` and `axe-playwright` during Storybook test runs.
By default, any axe accessibility violations fail the test suite.

To opt out a story when a violation is inherent to what is being demonstrated (such as a typography scale demo showing multiple heading levels):
use a scoped per-rule disable with an explanatory comment directly above the parameter:

```ts
parameters: {
  // heading-order: this story demonstrates the heading scale directly
  a11y: { config: { rules: [{ id: "heading-order", enabled: false }] } },
},
```

Every opt-out must include an explanatory comment justifying why the rule cannot be satisfied. If a per-rule disable does not fit, `failOnViolation: false` downgrades violations to logged warnings, or `disable: true` can be used for components that cannot be audited in isolation.

#### Visual regression

Every story is screenshotted and compared against a committed PNG baseline in `.storybook/__image_snapshots__/`, named `<story-id>-<theme>-<density>.png`. A story matches its baseline when at most 1% of pixels differ.

The committed baseline set is protected by a unit test floor in `tests/storybook-visual.test.ts` that asserts at least 126 PNGs exist, follow the naming pattern, and are non-empty. This guard runs on every `vp test` execution, so a missing or corrupted baseline set fails the test suite immediately, rather than silently re-recording platform-drifted snapshots or passing with no comparison.

The baselines are **rendered inside a container on purpose**. Text rasterization differs between DirectWrite (Windows), CoreText (macOS) and FreeType (Linux) on every glyph edge, which is far more than the 1% threshold allows, so a baseline generated on a developer machine can never pass on `ubuntu-latest`. Both the committed baselines and the CI comparison use `mcr.microsoft.com/playwright:v1.63.0-noble-amd64`, matching the pinned `playwright` devDependency.

To refresh the baselines after an **intentional design change**, run the Docker command below (a nightly workflow handles baselines that drift as `main` moves forward):

```bash
docker run --rm -t \
  -v "$(pwd)":/work -v /work/node_modules -v /work/storybook-static \
  -w /work mcr.microsoft.com/playwright:v1.63.0-noble-amd64 \
  bash -lc 'corepack enable pnpm \
    && corepack prepare pnpm@11.25.0 --activate \
    && pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm run build-storybook \
    && pnpm run test-storybook:visual:update:ci'
```

On a Linux host add `--user "$(id -u):$(id -g)"`, or the PNGs land root-owned. Swap `test-storybook:visual:update:ci` for `test-storybook:visual:ci` to verify without writing.

For a quick local loop against a dev server already on port 6006 — useful for checking that a story renders at all, but **not** for judging pixels, since host rendering differs from the container:

```bash
pnpm run test-storybook:visual
pnpm run test-storybook:visual:update
```

On failure, annotated diffs are written to `.storybook/__image_snapshots__/__diff_output__/` (gitignored) and uploaded as the `visual-diffs` artifact by CI.

#### Automated baseline refresh

A nightly workflow regenerates the committed baselines in the pinned container and opens a PR when they drift. Baselines go stale when a PR lands between generation and merge — a contributor who changed nothing visual discovers the false failure — so the automation keeps the set current as `main` moves forward. The workflow also runs on demand via `workflow_dispatch` in the Actions tab.

The refresh branch is `chore/visual-baseline-refresh`, force-pushed, with one long-lived PR. Only PNGs that fail the 1% threshold, or that do not yet exist, are written, so the diff is exactly the set of drifted baselines.

Opening the PR requires either the Actions "Allow GitHub Actions to create and approve pull requests" setting (Settings / Actions / General / Workflow permissions), or a `BASELINE_REFRESH_TOKEN` repository secret. The branch is pushed either way, so the workflow never loses data — it fails with a clear message naming the branch and the setting.

Opt a story out when it cannot produce stable pixels — a clock, a random seed, or an external site. The
parameter works on the meta, which covers every story in the file:

```ts
const meta: Meta<typeof Thing> = {
  title: "UI/Thing",
  component: Thing,
  parameters: { visual: { disable: true } },
};
```

or on a single story, when the rest of the file is fine:

```ts
export const Randomized: Story = {
  parameters: { visual: { disable: true } },
};
```

Currently opted out: `UI/Calendar` (seeded with `new Date()`), `Components/WebViewer` (frames an external
site), `Domain/Loading` → `Skeleton` (picks its line count and widths with `Math.random()`) and
`Components/AgentViewer` → `WithRichPlanLogs` (auto-scrolls, and its embedded diagrams resize the
container as they render, so the scroll lands a few pixels off each run). Animated stories do **not**
need it: the runner injects CSS that pauses animations and transitions before screenshotting.

A story whose content is _slow_ rather than unstable needs a settle delay instead of an opt-out. The
runner waits 100 ms between freezing the page and screenshotting it; stories that lazy-load a renderer
finish later than that and would otherwise be captured showing a loading placeholder:

```ts
parameters: { visual: { settleDelay: 3000 } },
```

`Renderers/MermaidRenderer`, `Renderers/GraphvizRenderer` and `Components/PlanMarkdown` use it, because
mermaid and `@hpcc-js/wasm-graphviz` are imported on first render and lay their diagrams out
asynchronously. A settle delay only helps when the story is still when it finishes — a story that both
renders late _and_ moves (`Components/AgentViewer` → `WithRichPlanLogs`) has to be opted out instead.

#### CI

The [storybook-tests.yml](.github/workflows/storybook-tests.yml) workflow runs on every push and pull request, as two jobs:

- **`test`** — builds Storybook and runs the accessibility and interaction pass. It caches Playwright browsers to avoid re-downloading on every run.
- **`visual`** — `needs: test`, so it only starts once accessibility is green. It runs in the pinned Playwright container (which already ships browsers, so no install step) and fails if any committed baseline is missing or if snapshots do not match.

## Development & Quality Gates

This project uses [Vite+](https://github.com/voidzero/vite-plus), a unified web toolchain that integrates:

- **Rolldown** & **tsdown** for fast bundling and `.d.mts` declaration generation
- **Oxlint** & **Oxfmt** for lightning-fast linting and formatting
- **Vitest** for unit testing

### Quality Checks

Run all linting, formatting, and type-checking in one command:

```bash
pnpm run check
# or
vp check
```

Auto-fix issues:

```bash
vp check --fix
```

### Windows: type-aware lint binary

Type-aware linting shells out to `tsgolint`. On Windows, pnpm only installs a `tsgolint.CMD` shim,
and that shim hands `cmd.exe` an unnormalized path into the virtual store — which exceeds the
260-character `MAX_PATH` limit whenever the checkout sits in a deep directory, so `vp check` fails
with:

```
Error running tsgolint: "exit status: exit code: 1"
The system cannot find the path specified.
```

`scripts/patch-tsgolint-win.mjs` fixes this by placing the native `tsgolint.exe` where Vite+ looks
for it before falling back to the shim, so `cmd.exe` is never involved. It is a no-op on non-Windows
platforms.

Every `pnpm install` deletes that binary again while relinking bins, so the script runs from
`prepare` (which pnpm executes _after_ bin linking) as well as from `pnpm lint` and `pnpm run check`.
You should never need to invoke it, but to re-apply the repair by hand:

```bash
node scripts/patch-tsgolint-win.mjs
```

Add `--json` to see what it resolved — the source binary, the target path and its length — without
writing anything.

**Retiring this repair:** The canary in `tests/tsgolintWinPatch.test.ts` fails when `oxlint-tsgolint` declares an `.exe` bin, or when pnpm's shim stops passing an unnormalized path. When that happens, the patch is obsolete and can be removed. Delete:

1. `scripts/patch-tsgolint-win.mjs`
2. `tests/tsgolintWinPatch.test.ts`
3. The `node scripts/patch-tsgolint-win.mjs && ` prefix on both `lint` and `check` in `package.json`
4. The ` && node scripts/patch-tsgolint-win.mjs` suffix on `prepare` (leave `vp config`)
5. This README subsection

To confirm manually: run `pnpm install --ignore-scripts`, then check if `node_modules/.pnpm/vite-plus@*/node_modules/.bin/tsgolint.exe` exists.

### Windows: line endings

The repo enforces LF line endings via `.gitattributes`, overriding your local `core.autocrlf` setting
— you do not need to change your global git config. If you cloned before `.gitattributes` was
committed, you may see `vp check` report formatting issues in files that show no diff in `git status`.
This happens when your working copy has CRLF but the committed blob is LF: git's stat cache keeps
reporting them clean, while oxfmt sees CRLF as incorrect.

To fix it, discard uncommitted work and re-checkout:

```bash
git rm --cached -rq . && git reset --hard
```

This empties the index and forces git to re-checkout every file with the correct line endings.

**Warning:** The command above discards all uncommitted changes. Commit or stash your work first.

For a single file:

```bash
rm <path> && git checkout -- <path>
```

**Note:** `git add --renormalize .` normalizes the index but does not update the working tree, so it
will not fix the `vp check` failure.

### Windows: MAX_PATH budget

Windows process creation fails at 260 characters, independently of the `LongPathsEnabled` registry flag. Tendril worktrees inherit this ceiling: the native TypeScript compiler (`tsc.exe`) that `vp pack` spawns sits at `<checkout-path> + 116-character suffix`, so a checkout path of 144 characters or more breaks builds with `The system cannot find the path specified.`

Tendril's worst-case worktree path for this repo is 126 characters (`D:\.tendril\Plans\` + a 66-character plan folder + `\Worktrees\SpaceCorps\components-storybook`), giving a 242-character target with 17 characters of headroom. `virtualStoreDirMaxLength: 40` in `pnpm-workspace.yaml` caps pnpm's virtual store directory names at 40 characters instead of the Windows default of 60, but does not shorten platform-specific package directories like `@typescript/typescript-win32-x64` that already fit under the cap. The binding constraint is the native compiler's path length, not the virtual store depth.

`tests/max-path-budget.test.ts` enforces the budget with three guards: (1) the declared and installed `virtualStoreDirMaxLength` agree, (2) every executable this repo spawns fits inside MAX_PATH from a maximum-depth Tendril worktree, and (3) a ratchet assertion that the deepest executable path in the tree has not grown. The test runs on Linux CI too, so the constraint is portable.

To measure your current path length, run the diagnostic command (reports `targetLength` without modifying anything):

```bash
node scripts/patch-tsgolint-win.mjs --json
```

### Testing

Run the test suite:

```bash
pnpm test
# or
vp test
```

Run tests in watch mode during development:

```bash
vp test --watch
```

### Library Packaging

Build the library for production:

```bash
pnpm run build
# or
vp pack
```

This command:

- Bundles all entrypoints (`index.ts`, `ui.ts`, `renderers.ts`, `tendril.ts`) to ESM modules
- Generates TypeScript declaration files (`.d.mts`) with `tsgo`
- Outputs to `dist/` directory with sourcemaps

Verify the build output:

```bash
ls dist/
# index.mjs        index.d.mts
# ui.mjs           ui.d.mts
# renderers.mjs    renderers.d.mts
# tendril.mjs      tendril.d.mts
```

### Development Workflow

Watch mode for rapid iteration:

```bash
pnpm run dev
# or
vp pack --watch
```

This rebuilds the library automatically on file changes.

## Project Structure

```
components-storybook/
├── src/
│   ├── index.ts              # Root entrypoint
│   ├── ui.ts                 # UI primitives entrypoint
│   ├── renderers.ts          # Renderers entrypoint
│   ├── tendril.ts            # Tendril widgets entrypoint
│   ├── components/           # Component implementations
│   │   ├── ui/               # 38+ Radix/shadcn primitives
│   │   ├── Shell/            # Tendril shell components
│   │   ├── AgentViewer/      # Agent execution visualizer
│   │   ├── PlanMarkdown/     # Plan markdown renderer
│   │   ├── TendrilDashboard/ # Analytics dashboard
│   │   └── ...
│   ├── lib/                  # Utility functions
│   ├── hooks/                # Custom React hooks
│   ├── contexts/             # React contexts
│   ├── styles/               # Global CSS and design tokens
│   └── types/                # TypeScript type definitions
├── tests/                    # Vitest test suite
├── stories/                  # Storybook stories
├── dist/                     # Built library output (gitignored)
├── dist-storybook/           # Built Storybook output (gitignored)
├── package.json              # Package manifest & scripts
├── vite.config.ts            # Vite+ configuration
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## License

MIT

## Contributing

Contributions are welcome! Please ensure all changes pass quality checks:

```bash
vp check && vp test
```
