/**
 * The search dialog as a reader meets it: open, type, pick a hit.
 *
 * `search.test.ts` covers the index; this covers the wiring around it — the lazy import that builds
 * the index on first open, the hits reaching the list, and selecting one navigating. Screenshotting
 * the built site is what caught the bug this file now guards: the dialog sat on "Building the index…"
 * because the effect's own `loading` state re-ran it and the cleanup cancelled the import.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePages } from "../src/lib/page";
import { SearchDialog } from "../src/components/SearchDialog";
import { readContent } from "./helpers";

const pages = [...parsePages(readContent()).values()];

function renderDialog() {
  const onOpenChange = vi.fn();
  const view = render(<SearchDialog open onOpenChange={onOpenChange} pages={pages} />);
  return { ...view, onOpenChange };
}

async function type(text: string) {
  const input = await screen.findByPlaceholderText("Search the documentation…");
  await userEvent.type(input, text);
  return input;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/docs/concepts");
});

describe("SearchDialog", () => {
  it("prompts before anything is typed", async () => {
    renderDialog();
    expect(await screen.findByText("Type to search every page.")).toBeInTheDocument();
  });

  it("has a screen-reader name and description, so Radix has no reason to complain", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Search the documentation" });
    expect(dialog).toHaveAccessibleDescription(/Type a few words to search every page/);
  });

  it("builds the index on first open and lists matching pages", async () => {
    renderDialog();
    await type("worktree");

    const hit = await screen.findByText("Onboarding a Codebase");
    expect(hit).toBeInTheDocument();
    // The stuck-loading regression showed up as this placeholder never being replaced.
    expect(screen.queryByText("Building the index…")).toBeNull();
    expect(screen.queryByText("No matches.")).toBeNull();
  });

  it("groups hits under their section", async () => {
    renderDialog();
    await type("promptware");

    await screen.findByText("Promptwares");
    // "Concepts" also occurs in hit snippets, so match the group heading itself.
    const headings = [...document.querySelectorAll("[cmdk-group-heading]")].map(
      (heading) => heading.textContent,
    );
    expect(headings).toContain("Concepts");
  });

  it("says so when nothing matches", async () => {
    renderDialog();
    await type("zzzznotawordzzzz");

    expect(await screen.findByText("No matches.")).toBeInTheDocument();
  });

  it("navigates to the selected page and closes", async () => {
    const { onOpenChange } = renderDialog();
    await type("worktree");
    await userEvent.click(await screen.findByText("Onboarding a Codebase"));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/docs/gettingstarted/onboarding");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
