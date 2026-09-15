# UI parity contract (V2 React <- V1 C#)

Rules for anyone (human or agent) aligning a V2 view with its Tendril V1 counterpart. The point is that
many people work different areas in parallel and the result still looks like one application.

## Source of truth

V1 lives at `/Users/rorychatt/git/ivy/Ivy-Tendril` (repo `Ivy-Interactive/Ivy-Tendril`), and it has **two**
layers you need, not one.

**1. V1's own React widgets** live at `src/Ivy.Tendril.Widgets/frontend/src/`, with directories that pair
almost 1:1 with V2's `packages/components/src/components/`: `Shell/`, `ChatWidget/`, `PlanWorkspace/`,
`PlanDiffView/`, `PlanMarkdown/`, `TendrilDashboard/`, `TendrilProcessViewer/`, `TendrilQuestions/`,
`AgentViewer/`, `ContentInput/`, `SortableVerificationList/`, `BadgeSelect/`, `WebViewer/`.

V2's components are an **older fork of these files**, not an independent port. So for anything with a
counterpart there, diff React against React and bring the fork forward; do not reimplement from the C#
and do not invent new markup. Those directories also carry co-located `*.test.tsx` files that encode
intended behaviour - read them. This was learned the hard way on the shell, where the C# told us what to
compose but the fork told us why every row was drifting while collapsing.

**2. The C# apps** (`src/Ivy.Tendril/Apps/**`, `AppShell/**`) are declarative: each screen is a `ViewBase`
whose `Build()` composes Ivy Framework widgets. Use these as the authority for *which* widgets are
composed, in what order, with what arguments, and for labels, empty states and visibility rules.

Either way: when V1 made a decision, copy the decision. Not a screenshot, not taste.

Shared UX numbers live in `src/Ivy.Tendril/Helpers/UxHelper.cs` (e.g. `UxHelper.SheetWidth`). Port those
constants rather than inventing new ones.

## Colour and spacing

- The palette is generated from `@ivy-interactive/ivy-design-system` into the marked region of
  `src/packages/components/src/styles/tokens.css`. **Never edit that region by hand** and never add a
  colour token. Run `pnpm sync:tokens` in `src/packages/components` if it is stale.
- Use semantic tokens only: `bg-primary`, `text-muted-foreground`, `border-border`, and so on. No hex
  literals, no `bg-zinc-800`, no arbitrary values like `bg-[#18181b]`.
- `--primary` is Ivy green (`#00cc92`). If a surface looked right against the old near-black primary and
  now looks wrong, the fix is the correct token, not a hardcoded colour.
- Spacing is Tailwind's scale with `--spacing: 0.27rem`, matching V1. Do not introduce a second scale.

## Reuse before writing

Check `src/packages/components/src/components/` first. The shell chrome, chat primitives, terminal,
markdown and diff renderers, dashboard widgets and form controls already exist. Extending a shared
component beats duplicating it, but see ownership below.

## Ownership

Each area owns a disjoint set of files and touches nothing else. Shared surfaces (`tokens.css`, `ui/**`,
barrel `index.ts` files, `components/Shell/**`) have exactly one owner. If your area needs a change to a
file you do not own, **do not make it** - report it, with the exact change and why, and it gets applied
centrally. This is what keeps parallel work from conflicting.

## Tests

Keep the tests for your area green, and run only those files, not the whole suite:

```bash
cd src/apps/tendril-app && pnpm test -- tests/<your-area>.test.tsx
```

Update a test only where V1 parity genuinely changes intended behaviour, and say so explicitly in your
report. Two known pre-existing failures are not yours: `git-hooks.test.ts` in the components package
(missing local `.vite-hooks/pre-commit`) and an initial-bundle-size assertion in the app package.

## Reporting

Report back: what changed, which C# file and decision each change mirrors, deliberate deviations with
reasons, changes needed in files you do not own, and test status. Do not run `git` commands; commits are
made centrally per area.

## Conventions

Match surrounding code style. Note that V1's `AGENTS.md` bans em dashes; that is a V1 rule and does not
apply here, so do not reformat V2 prose to follow it.
