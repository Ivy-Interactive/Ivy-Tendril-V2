### Wireframes

A wireframe is a hand-drawn React mockup of a screen, kept in the plan folder and shown to the
reviewer live inside the plan. It has two jobs and only two: showing the user what will be built,
and guiding the agent that builds it. It is throwaway plan material, never product code.

#### When to make one

Every planning run decides this explicitly, as a step of its own, and records the decision.

**Make one** when the plan adds or reshapes something a user sees and uses:

- a new screen, page, dialog, panel or tool, **including one that follows an existing pattern**. The
  pattern says what kind of page it is; the wireframe shows the specific layout this plan proposes,
  which is what the reviewer is agreeing to
- a layout or navigation change
- a new multi-step flow
- a choice between two layouts (one wireframe each)

A simple test: if the Solution would describe a layout in prose (what sits where, which controls, in
which order), the plan needs a wireframe instead.

**Do not make one** for: bug fixes, UI bugs included; backend, API, CLI, database, infrastructure,
build or test work; refactors, performance work, docs or dependency bumps; copy changes, colour or
spacing tweaks, or one new button or field in an existing form; a change an existing screenshot
already shows.

A revision embeds **at most 2** wireframes. A project with `wireframes: false` in its configuration
gets none, and `tendril wireframe setup` refuses in its plans.

#### How to make one

```bash
tendril wireframe agent-readme                                  # components and props: read it first
tendril wireframe setup "<PlanFolder>/Wireframes/<name>"        # <name> is a lowercase slug
# edit src/App.tsx using only the tendril-wireframes components
tendril wireframe screenshot "<PlanFolder>/Wireframes/<name>"   # writes screenshots/1440x900.png
# read the PNG, fix what looks wrong, and screenshot again
```

- A wireframe lives only at `<PlanFolder>/Wireframes/<name>/`. Never create one in a repo or a worktree.
- Screenshots exist only so you can check your own work. Never put a screenshot, or any wireframe
  code, in a revision.
- Keep the `@tendril-wireframe plan-only` line at the top of each file.
- Create the wireframe before writing the revision that embeds it: `write-revision` rejects a block
  naming a wireframe that does not exist yet.
- When updating a plan, edit its existing wireframe in place and keep its name. No `-v2` copies.
  Remove the block when the UX is no longer part of the plan.

#### Embedding it in the revision

Put the wireframe **at the top of the plan**, in a `## Wireframe` section that is the first section:
directly under the `# {title}` heading, before any `questions` block and before `## Problem`. A
reviewer then sees what will be built before reading anything else. A second wireframe goes in the
same section, straight after the first. It updates live while you edit it.

`````
````markdown
# Add JSON to CSV Converter Tool

## Wireframe

```wireframe
name: json-csv-converter
```

## Problem
...
````
`````

Do not also describe the layout in prose: the Solution refers to the wireframe by name and covers
what the wireframe cannot show (behaviour, validation, edge cases).

The fence itself:

````
```wireframe
name: checkout-payment        # required: the folder under Wireframes/
height: 640                   # optional: pixels; the default is the wireframe's own height
viewport: Mobile              # optional: Desktop | Tablet | Mobile; the default is the plan column's width
```
````

A fence holding only a name (`checkout-payment`) is shorthand for `name: checkout-payment`.

`tendril plan write-revision` rejects, and writes nothing for, a revision with a malformed block, a
block naming a wireframe the plan does not have, more than 2 blocks, a block outside the
`## Wireframe` section, or a `## Wireframe` section that is not the first section. `--no-question-check` skips
these checks together with the question checks.

#### During execution

A wireframe is a layout reference. Build the screen with the project's own UI stack and components.
Never copy a wireframe's files, components or markup into a repo, and never add `tendril-wireframes`
to a project. Tendril checks every plan's changes for wireframe code before the plan reaches Review,
a PR or Completed, and refuses it when it finds any. Run `tendril plan check-wireframes <plan-id>` to
see what that check finds.
