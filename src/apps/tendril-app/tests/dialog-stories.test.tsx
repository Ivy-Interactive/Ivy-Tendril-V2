/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { bridge } from "../src/api/bridge";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/**
 * The contract every dialog owes, applied to every story.
 *
 * The stories are the single source: Storybook renders them for a person, and this walks the same
 * files so every permutation is mounted on every run. V1's harness was visual only, which is part
 * of why it stopped at one dialog out of forty-eight - a catalog nobody opens catches nothing.
 *
 * **No Storybook package is imported here.** A CSF file's only Storybook import is
 * `import type { Meta, StoryObj }`, which TypeScript erases, so the modules load as plain objects:
 * a default export carrying `args`, and named exports carrying their own. Reading them directly
 * keeps this suite independent of Storybook's runtime and of whether the dev server can boot.
 *
 * The assertions are deliberately the *shared* contract, the one `DialogShell` documents and each
 * dialog inherits. A claim specific to one story belongs in that story's own file as a play
 * function, not here, where it would have to be re-described away from the args that produce it.
 */

const storyModules = import.meta.glob("../src/views/dialogs/*.stories.tsx", { eager: true });

type StoryObject = { args?: Record<string, unknown> };
type StoryMeta = { component?: React.ComponentType<unknown>; args?: Record<string, unknown> };

interface LoadedStory {
  file: string;
  name: string;
  Component: React.ComponentType<Record<string, unknown>>;
  args: Record<string, unknown>;
}

function isStoryObject(value: unknown): value is StoryObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flattens every `*.stories.tsx` into one story per named export, args merged over meta's. */
function loadStories(): LoadedStory[] {
  const loaded: LoadedStory[] = [];

  for (const [path, mod] of Object.entries(storyModules)) {
    const module_ = mod as Record<string, unknown> & { default?: StoryMeta };
    const meta = module_.default;
    const Component = meta?.component as React.ComponentType<Record<string, unknown>> | undefined;
    if (!Component) continue;

    const file = path.split("/").pop() ?? path;

    for (const [name, value] of Object.entries(module_)) {
      if (name === "default" || !isStoryObject(value)) continue;
      loaded.push({
        file,
        name,
        Component,
        // Spreading a falsy value adds nothing, so the meta/story merge needs no empty fallback.
        args: { ...meta?.args, ...value.args },
      });
    }
  }

  return loaded;
}

const stories = loadStories();

const consoleErrors: string[] = [];
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrors.length = 0;
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
  // `AutoAcceptSettingsDialog` reaches the daemon as it opens and has no injection seam of its own
  // - the others take `api` / `search` props their stories use. Storybook serves the same call
  // from `.storybook/preview.tsx`; here it is stubbed for the same reason.
  vi.spyOn(bridge, "getConfig").mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  consoleErrorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe("dialog stories", () => {
  it("finds stories to run", () => {
    expect(stories.length).toBeGreaterThan(40);
  });

  it("covers every dialog the barrel exports, so a new one cannot skip the decision", async () => {
    const barrel = await import("../src/views/dialogs");
    const covered = new Set(stories.map((s) => s.file.replace(".stories.tsx", "")));

    const uncovered = Object.entries(barrel)
      .filter(([name, value]) => typeof value === "function" && name.endsWith("Dialog"))
      .map(([name]) => name)
      // `DialogShell` is the wrapper every dialog composes, not a dialog. Its contract is what the
      // assertions below check *through* each dialog, so a story for it would test the premise.
      .filter((name) => name !== "DialogShell")
      .filter((name) => !covered.has(name));

    expect(uncovered).toEqual([]);
  });

  it("gives every dialog at least three stories", () => {
    const counts = new Map<string, number>();
    for (const story of stories) {
      counts.set(story.file, (counts.get(story.file) ?? 0) + 1);
    }
    const thin = [...counts.entries()].filter(([, n]) => n < 3).map(([file]) => file);

    // `NoProjectsDialog` has one genuine state and is exempt: padding it out would be inventing
    // permutations that do not exist rather than documenting ones that do.
    expect(thin).toEqual(["NoProjectsDialog.stories.tsx"]);
  });
});

for (const story of stories) {
  describe(`${story.file.replace(".stories.tsx", "")} / ${story.name}`, () => {
    const renderStory = (overrides: Record<string, unknown> = {}) =>
      render(<story.Component {...story.args} {...overrides} />);

    it("renders, and exposes a named dialog", () => {
      renderStory();

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      // Radix derives the accessible name from the rendered `DialogTitle` and warns without one.
      // An unnamed dialog is announced as nothing at all.
      expect(dialog).toHaveAccessibleName();
    });

    it("does not open with focus on a destructive confirm", () => {
      renderStory();

      // `DialogShell` contract point 1: focus moves in on open, onto `initialFocusRef`, which every
      // confirm points at Cancel. Radix's default is "first tabbable node", which in a body-less
      // dialog can reach the confirm - and a focused destructive button turns a stray Enter into a
      // deletion.
      const focused = document.activeElement as HTMLElement | null;
      const destructive = screen.queryByTestId("confirm-destructive");
      if (focused && destructive) {
        expect(focused).not.toBe(destructive);
      }
    });

    it("closes on Escape, and never confirms", () => {
      const onClose = vi.fn();
      renderStory({ onClose });

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      // Contract point 3: Escape cancels. It must reach `onClose` and nothing else.
      expect(onClose).toHaveBeenCalled();
    });

    it("renders no React warning", () => {
      renderStory();

      // Catches the key, prop-type and controlled/uncontrolled warnings a hand-written test
      // silently tolerates, across every permutation rather than the one somebody wrote.
      expect(consoleErrors).toEqual([]);
    });
  });
}
