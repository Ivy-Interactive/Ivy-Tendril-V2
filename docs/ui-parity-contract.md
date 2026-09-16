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

## Behavioural parity (second pass)

The first pass aligned *composition and appearance*: which widgets, in what order, with what labels.
This pass is about *behaviour*, which is where the real divergence turned out to live. For your area,
the V1 C# is the authority on all of it:

- **State machines.** Every state a view can be in, what moves it between them, and what is disabled,
  hidden or read-only in each. V1's `ViewBase.Build()` plus its `UseState`/`UseEffect` calls are the
  spec.
- **Actions and their guards.** What each button actually does, what it refuses to do and why, what it
  does optimistically versus after the service confirms, and what it does on failure.
- **Data flow.** What is fetched, when, how often, what invalidates it, and what is re-read rather than
  assumed. A V1 view that re-reads from the service on click and not just on render is making a
  deliberate choice — copy it.
- **Edge cases.** Empty, single-item, very large, offline, mid-flight, terminal-state and
  permission-denied. These are where a port silently does nothing instead of the right thing.
- **Wiring that exists but is unreachable.** A prop nobody passes, a callback nobody supplies and a
  handler nobody calls are all equivalent to the feature being absent. Check that each behaviour you
  port is actually reachable from the running app, and say so.

Report behavioural divergence even where you cannot fix it in files you own — that is the most valuable
thing you can produce.

## Structural parity (third pass): the shell owns the lists

The first pass matched composition inside a view; the second matched behaviour. Both missed the level
above: **V1's information architecture**. V2 currently renders, in the content area, lists that V1 puts
in the shell sidebar — which makes the app read as a set of standalone pages rather than one shell with
a contextual sidebar.

### The sidebar contextual list

In V1, five apps do **not** render their own list. They publish one into the shell sidebar and the
shell renders it, routing a click back as a normal navigation:

- `AppShell/ShellSidebarListSignal.cs` — the contract. The active app publishes `ShellSidebarListState`
  **on every build**; the shell renders it and routes item clicks through `BuildSelectArgs`.
- `AppShell/TendrilAppShell.cs`'s `SidebarSectionAppIds` names them: **`review`, `plans`, `drafts`,
  `recommendations`, `chat`**.
- `PageTabTitle` makes the page tab's title the *selected sidebar row*, not the app name.
- `UsesSidebarList` keeps a published list visible while the user is on any sidebar-section app, so
  moving between them does not blank the sidebar.

V2 already has the whole widget family forked and **unused**:
`packages/components/src/components/Shell/` — `ShellSidebarSection`, `ShellSectionItems`,
`ShellRailFlyout`, `ShellSidebarHeader`. `ShellSectionItemDto` in `Shell/types.ts` is already
field-for-field identical to V1's `ShellDtos.cs`. Nothing in `apps/tendril-app/src` renders any of it.

**The contract to implement, mirroring `ShellSidebarListState` exactly.** One owner implements the
shell side; the five apps publish against this and nothing else:

```ts
export interface ShellSidebarList {
  appId: string;                 // "review" | "plans" | "drafts" | "recommendations" | "chat"
  title: string;
  items: ShellSectionItemDto[];  // already exists in Shell/types.ts — do not redefine it
  selectedId: string | null;
  /** A click becomes a navigation to `appId` with these args. */
  buildSelectArgs: (id: string) => unknown;
  searchable?: boolean;          // default true
  onSearch?: () => void;         // null/absent means the plan search dialog
  searchLabel?: string;          // absent reads "Search plans"
  onNew?: () => void;
  newLabel?: string;
  /** Folds the collapsed rail's list into one flyout button instead of narrow id chips. */
  collapsedMenu?: boolean;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string) => void;
}
```

Two rules follow from V1 and are easy to get wrong: a published list must survive navigation between
sidebar-section apps, and the page tab title follows the selected row.

### Tables are tables

V1 renders collections with `ToDataTable`. V2 has a full `DataTable` under
`packages/components/src/components/ui/data-table/` — row actions, inline cell edit, column visibility
— and `InboxView` already uses it. Anything V1 renders as a table must use it rather than a
hand-rolled card grid. `Apps/Jobs/JobsApp.DataTable.cs` is the reference for columns, ordering, row
menu and its live per-cell update stream.

### Nested navigation

`Apps/Settings/SettingsApp.cs` is a **nested sidebar** of `SidebarListRow` rows, one of which
(`Projects`) is expandable with a sub-item per project plus "Add Project", and it opens editors as
**blades** (`Apps/Settings/Blades/`). It is not a flat stack of cards. Note `SidebarListRow.Build` /
`BuildExpandable` / `BuildSubItem` currently has no shared V2 component — `InboxView` reimplemented all
three locally, so extracting them is a prerequisite rather than a nicety.

### Rule for this pass

If V1 put something in the shell, put it in the shell. A view that renders its own list, its own
nav, or its own table where V1 published to the shell or used a `DataTable` is a structural
divergence even when every label and behaviour inside it is right.

### Routing: a hybrid shell, not a tab bar

`AppShell/AppShellRouter.cs` (127 lines) states the architecture in its own doc comment:

> Routing for the hybrid shell: regular apps render as the single page inside the content frame,
> while session apps (AllowDuplicateTabs — agent terminals and review actions) open as tabs in the
> bottom session strip.

So there are two destinations, and which one a navigation reaches is a *routing decision*, not a
caller's choice. `Route(navigateArgs, navigationMode, defaultAppId, sessionTabs, appDescriptor)`
returns one of five actions — `OpenPage`, `SwitchToExistingTab`, `CreateNewTab`, `Error`, `Noop` —
by these rules, in order:

1. **A `TabId` means restoring an existing session tab**, e.g. from browser history. Found → switch to
   it. Not found *and* the navigation is a history `Pop` → `Error("Tab no longer exists.")`, because
   silently opening something else would rewrite the user's history under them.
2. **No `AppId` → `Noop`.**
3. **`AllowDuplicateTabs` app → a session tab.** But first: a terminal session's pane is keyed by its
   session id, so reopening the same session **reveals the existing pane rather than spawning a second
   agent**. Only then `CreateNewTab`.
4. **Everything else → `OpenPage`.** One page in the content frame. A page is never a tab.

What this requires of navigation, and what V2 does not have:

- **`NavigateArgs` carries `{ appId, appArgs, tabId?, historyOp? }`.** V2's navigation is a bare
  string (`uiStore.setActiveNav(nav)`), which is why the sidebar contract's `buildSelectArgs` has
  nowhere to deliver its args and every publisher has to apply the selection itself as a side effect.
  That is a workaround for a missing router, not a design.
- **History**, including `replaceHistory` and the `HistoryOp.Pop` distinction above.
- **A `defaultAppId`**, used when a navigation names no app.

V2 additionally does the opposite of rule 4: `uiStore.setActiveNav` pushes every nav into
`activeTabIds`, and `setSelectedPlanId` pushes a `plan-<id>` tab, so ordinary pages accumulate in the
session strip. `Apps/Jobs/Sheets/OutputSheet.cs` is the reminder that not everything even wants a
page: job output is a **sheet** over the jobs table in V1, and V2 made it a tab.
