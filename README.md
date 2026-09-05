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
- **`components-storybook/renderers`** — Rich content renderers (Markdown, Mermaid, Graphviz, Code, Chat, ErrorBoundary)
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
import {
  MarkdownRenderer,
  MermaidRenderer,
  GraphvizRenderer,
  JsonRenderer,
} from "components-storybook/renderers";

function ContentDemo() {
  const markdownContent = "# Hello\n\nThis is **Markdown** content.";
  const mermaidDiagram = "graph TD; A-->B; B-->C;";
  const dotGraph = "digraph G { A -> B -> C; }";
  const jsonData = { name: "Example", value: 42 };

  return (
    <div className="space-y-6">
      <MarkdownRenderer content={markdownContent} />
      <MermaidRenderer chart={mermaidDiagram} />
      <GraphvizRenderer dot={dotGraph} />
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

## Storybook Catalog Showcase

This project includes a comprehensive Storybook catalog showcasing all components with interactive examples and documentation.

### Interactive Development

Launch the Storybook development server:

```bash
pnpm run storybook
# or
vp run storybook
```

Navigate to `http://localhost:6006` to explore the component catalog.

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
