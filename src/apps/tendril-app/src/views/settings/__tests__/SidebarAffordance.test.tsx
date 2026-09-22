import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Folder } from "lucide-react";

import { SidebarExpandableRow, SidebarRow, SidebarSubItem } from "../SidebarListRow";

/**
 * The Settings rail's rows have to look clickable.
 *
 * Reported as "cursor hover events don't work properly in the settings app -- it does not suggest
 * that elements in the sidebar or the subapps of settings are at all clickable". The cause was not in
 * this directory: these three wrappers delegate to the package's `SidebarListRow`, and it had lost
 * `cursor: pointer` when the repo moved to Tailwind v4. v3's preflight shipped
 * `button, [role="button"] { cursor: pointer }`; v4 (4.1.16) dropped it, so every row in this rail
 * silently became a `<button>` with `cursor: auto`. The hover fill failed separately and less
 * visibly: `hover:bg-accent` compiled and applied, but `--accent` is `#f8f8f8` on this rail's
 * `#ffffff`, a 1.06:1 fill nobody can see.
 *
 * The package suite pins the shared component. This file pins the *delegation* -- that the rail
 * Settings actually renders still carries the affordance through these wrappers -- because the bug
 * the user hit was reachable only through them, and a wrapper that dropped a class on its way down
 * would leave the package's own tests green.
 *
 * Classes rather than computed style: jsdom resolves no Tailwind cascade, so nothing here can see the
 * compiled rule and the class string is the only honest witness.
 */

const rows: [string, React.ReactElement][] = [
  ["section row", <SidebarRow key="a" icon={Folder} label="Plans" onClick={vi.fn()} />],
  [
    "expandable Projects row",
    <SidebarExpandableRow
      key="b"
      icon={Folder}
      label="Projects"
      expanded={false}
      onClick={vi.fn()}
    />,
  ],
  ["project sub-item", <SidebarSubItem key="c" label="Tendril" onClick={vi.fn()} />],
];

describe("Settings sidebar affordance", () => {
  it.each(rows)("gives the %s a pointer cursor", (_name, element) => {
    render(element);
    expect(screen.getByRole("tab").className).toContain("cursor-pointer");
  });

  it.each(rows)("gives the %s a hover fill that is actually visible", (_name, element) => {
    render(element);
    const className = screen.getByRole("tab").className;
    // `--secondary` -- the token the selected row already uses -- not `--accent` at 1.06:1 on white.
    expect(className).toContain("hover:bg-secondary/60");
    expect(className).not.toContain("hover:bg-accent");
  });

  /**
   * Every row in this rail is a tab in a `role="tablist"`, which is what these wrappers exist to fix.
   * A tab with no visible focus is reachable by keyboard and invisible while you are on it.
   */
  it.each(rows)("gives the %s a focus ring", (_name, element) => {
    render(element);
    expect(screen.getByRole("tab").className).toContain("focus-visible:ring-2");
  });

  /** An idle row reads at the same size and contrast as a selected one, not smaller and grayed out. */
  it.each(rows)("gives the idle %s readable text", (_name, element) => {
    render(element);
    const className = screen.getByRole("tab").className;
    expect(className).toContain("text-sm");
    expect(className).toContain("text-foreground");
  });
});
