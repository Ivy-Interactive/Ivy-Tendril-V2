# @ivy-interactive/tendril-docs

The Tendril documentation site: a static, markdown-driven site built with Vite+ and React, rendered
through the same `MarkdownRenderer` and the same design tokens as the desktop app.

```bash
pnpm dev:docs                                     # http://127.0.0.1:5174/docs/
pnpm --filter @ivy-interactive/tendril-docs build  # static output in dist/
pnpm --filter @ivy-interactive/tendril-docs test
pnpm --filter @ivy-interactive/tendril-docs check
```

The site needs the components library's build output, so run
`pnpm --filter @ivy-interactive/components build` once before the first `dev` or `build`.

## Authoring

Adding a page is adding a file. There is no manifest, no code generation and no build step to teach:

```
content/<NN>_<SectionName>/_Index.md        # required — the section's own page
content/<NN>_<SectionName>/<NN>_<Page>.md   # a page in that section
content/assets/<file>                       # images
```

`import.meta.glob` picks the file up, [`src/lib/nav.ts`](src/lib/nav.ts) grows a navigation node,
[`src/lib/search.ts`](src/lib/search.ts) grows a search document, and the `emitRouteShells` plugin
emits a static shell for its URL.

### Rules

| Rule | Detail |
| --- | --- |
| Numbering | Every section folder and page file carries a two-digit `NN_` prefix. It drives navigation order only and is stripped from the URL. |
| Section index | Every section folder has an `_Index.md` with a real `# Heading` and a body listing its pages. A section folder without one is a build error, not a warning. |
| Nesting | Section folders may nest. A nested folder is a sub-section and needs its own `_Index.md`. |
| Slugs | Folder or file name minus `NN_`, lowercased, every run of non-alphanumerics collapsed to `-`. `01_GettingStarted/02_Installation.md` → `/docs/gettingstarted/installation`; `02_Concepts/_Index.md` → `/docs/concepts`. |
| No markdown directly in `content/` | Every page belongs to a section. A stray `content/foo.md` is a build error. |

### Frontmatter

All keys are optional; unknown keys are ignored rather than rejected.

```yaml
---
title: Installation # defaults to the first `# ` heading, then to the de-slugged file name
description: Build Tendril from source and run the desktop app. # rendered as the lead paragraph
icon: Download # a lucide name from src/lib/icons.ts
searchHints: [setup, prerequisites, cargo] # extra search terms the prose never says
groupExpanded: true # _Index.md only: open this section in the sidebar by default
---
```

`icon` must be one of the names in [`src/lib/icons.ts`](src/lib/icons.ts). An unlisted name logs a
warning and falls back — add the icon to that file rather than relying on the fallback.

### Links

**Write relative `.md` paths, never a route.**

```markdown
[Promptwares](../02_Concepts/02_Promptwares.md)
[Tutorial](04_Tutorial.md)
[the section index](_Index.md)
[step 2 of the tutorial](04_Tutorial.md#create-a-plan)
![The plan lifecycle](../assets/lifecycle.png)
```

Two reasons this is a hard rule rather than a preference:

1. `lychee` — the link checker the repo already runs in CI as `pnpm check:links` — resolves a relative
   `.md` target against the file's own directory and fails when it does not exist. A route such as
   `/docs/concepts/promptwares` is invisible to it, so a typo would ship.
2. The URL scheme stays an implementation detail. `src/lib/links.ts` rewrites every target to its
   final route before rendering, so the site can change its scheme without a content migration.

`tests/content-links.test.ts` enforces it: every relative target must resolve to a file, every
`#anchor` must match a heading in the target file, no target may be an absolute `/docs/...` route, and
every image must resolve under `content/assets/`. `http(s)` and `mailto` targets are left to lychee.

### Markdown features

Everything `MarkdownRenderer` supports is available: GFM tables and task lists, fenced code blocks
with syntax highlighting, GitHub alerts, math, Mermaid and DOT diagrams, and emoji shortcodes.

```markdown
> [!TIP]
> Alerts are plain GitHub alert syntax — `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`,
> `[!CAUTION]`.
```

Do not use component syntax from the original dotnet docs site (`<Ingress>`, `<Callout>`, `<Embed>`,
`<style>` or ` ```csharp demo ` blocks). Map them instead: `<Ingress>` → frontmatter `description`,
`<Callout type="tip">` → `> [!TIP]`, `<Embed Url="…"/>` → a plain markdown link, a demo block → a real
`bash` or `powershell` fence.

## How it fits together

```
content/**/*.md
  └─ src/content.ts        import.meta.glob("?raw", eager) — the single source of truth
       ├─ src/lib/nav.ts     buildNavTree()  → the sidebar, pager and route list
       ├─ src/lib/page.ts    parsePage()     → title, description, headings, body
       └─ src/lib/search.ts  buildSearchIndex() — lazy chunk, loaded on first ⌘K
```

- `src/lib/slug.ts` — path ⇄ route mapping. Pure, unit-tested.
- `src/lib/frontmatter.ts` — `---` block via the `yaml` package; malformed YAML warns and degrades.
- `src/lib/links.ts` — relative `.md` → route rewriting, applied to the markdown source.
- `src/lib/router.ts` — a History-API router, ~80 lines, no dependency.
- `src/plugins/emit-route-shells.ts` — copies the built `index.html` to `<route>/index.html` for every
  route, so `dist/` is a complete static site that any static host can serve, and rewrites deep links
  to the shell in dev.

Theming is not a docs feature: `src/styles/docs.css` imports the real
`@ivy-interactive/components/styles/globals.css`, so the `:root` / `.dark` token blocks that theme the
desktop app theme the docs site too. `ThemeToggle` only calls `setTheme` on the shared
`ThemeProvider`.
