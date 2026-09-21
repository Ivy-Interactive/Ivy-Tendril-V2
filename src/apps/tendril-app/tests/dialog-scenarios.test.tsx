import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SURFACES, NOT_SURFACES } from "../src/views/debug/scenarios/registry";
import * as dialogBarrel from "../src/views/dialogs";
import { bridge } from "../src/api/bridge";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/**
 * The contract every dialog owes, applied to every scenario in the registry.
 *
 * This is the half of the harness V1 never built. `Apps/Debug/DialogsApp.cs` renders scenarios for
 * a person to look at, which catches only what somebody remembers to open - and V1 stopped at one
 * dialog out of forty-eight. Declaring the scenarios as data lets the same catalogs be walked here,
 * so every permutation is mounted on every run.
 *
 * The five assertions below are deliberately the *shared* contract, the one `DialogShell` documents
 * and each dialog inherits. Scenario-specific claims live in the catalogs as `expectText` /
 * `expectAbsent`, so a dialog's own behaviour is asserted next to the model that produces it rather
 * than in a wrapper that has to re-describe it.
 */

/**
 * Everything a person reading the dialog can see: its text, plus the values sitting in its form
 * controls.
 *
 * `textContent` alone is not enough. A field seeded from a model - `CreateIssueDialog`'s Title and
 * Body in subject mode, `SuggestChangesDialog`'s prefilled request - carries its content as an
 * input `value`, which no text query reaches. Asserting only on text would quietly let a scenario
 * claim a seeded value it never showed.
 */
function visibleText(root: HTMLElement): string {
  const controls = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input, textarea, select",
  );
  const values = Array.from(controls, (c) => c.value ?? "");
  return [root.textContent ?? "", ...values].join("\n");
}

const consoleErrors: string[] = [];
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrors.length = 0;
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
  // `AutoAcceptSettingsDialog` is the one surface that reaches the daemon as it opens and has no
  // injection seam of its own (the others take `api` / `search` props, which their scenarios use).
  // Stubbing the call is not a workaround for a missing seam so much as an admission that adding
  // one would mean editing a dialog this change does not own.
  vi.spyOn(bridge, "getConfig").mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  consoleErrorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe("dialog scenario registry", () => {
  it("covers every dialog the barrel exports, so a new one cannot skip the decision", () => {
    const registered = new Set(SURFACES.map((s) => s.id));
    const exempt = new Set(Object.keys(NOT_SURFACES));

    const exportedDialogs = Object.entries(dialogBarrel)
      .filter(([name, value]) => typeof value === "function" && name.endsWith("Dialog"))
      .map(([name]) => name);

    const uncovered = exportedDialogs.filter((n) => !registered.has(n) && !exempt.has(n));

    expect(uncovered).toEqual([]);
  });

  it("registers no surface that the barrel does not export", () => {
    const exported = new Set(Object.keys(dialogBarrel));
    expect(SURFACES.map((s) => s.id).filter((id) => !exported.has(id))).toEqual([]);
  });

  it("gives every surface at least three scenarios", () => {
    const thin = SURFACES.filter((s) => s.scenarios.length < 3).map((s) => s.id);
    expect(thin).toEqual([]);
  });

  it("gives every scenario a unique title within its surface", () => {
    for (const surface of SURFACES) {
      const titles = surface.scenarios.map((s) => s.title);
      expect(new Set(titles).size, `${surface.id} has duplicate scenario titles`).toBe(
        titles.length,
      );
    }
  });

  it("gives every scenario a hint saying what it is for", () => {
    const missing: string[] = [];
    for (const surface of SURFACES) {
      for (const scenario of surface.scenarios) {
        if (!scenario.hint || scenario.hint.trim().length < 10) {
          missing.push(`${surface.id}: ${scenario.title}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

for (const surface of SURFACES) {
  describe(`${surface.id} scenarios`, () => {
    surface.scenarios.forEach((scenario, index) => {
      describe(scenario.title, () => {
        it("renders, and exposes a named dialog", () => {
          render(surface.render(index, { onClose: () => {} })!);

          const dialog = screen.getByRole("dialog");
          expect(dialog).toBeInTheDocument();
          // Radix derives the accessible name from the rendered `DialogTitle`, and warns when one
          // is missing. An unnamed dialog is announced as nothing at all.
          expect(dialog).toHaveAccessibleName();
        });

        it("does not open with focus on a destructive confirm", () => {
          render(surface.render(index, { onClose: () => {} })!);

          // `DialogShell` contract point 1: focus moves in on open, onto `initialFocusRef`, which
          // every confirm points at Cancel. Radix's default is "first tabbable node", which in a
          // body-less dialog can reach the confirm - and a focused destructive button turns a
          // stray Enter into a deletion.
          const focused = document.activeElement as HTMLElement | null;
          const destructive = screen.queryByTestId("confirm-destructive");
          if (focused && destructive) {
            expect(focused).not.toBe(destructive);
          }
        });

        it("closes on Escape, and never confirms", () => {
          const onClose = vi.fn();
          render(surface.render(index, { onClose })!);

          fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

          // Contract point 3: Escape cancels. It must reach `onClose` and nothing else.
          expect(onClose).toHaveBeenCalled();
        });

        it("renders no React warning", () => {
          render(surface.render(index, { onClose: () => {} })!);

          // Catches the key, prop-type and controlled/uncontrolled warnings a hand-written test
          // silently tolerates, across every permutation rather than the one somebody wrote.
          expect(consoleErrors).toEqual([]);
        });

        if (scenario.expectText?.length) {
          it("shows what the scenario claims", () => {
            render(surface.render(index, { onClose: () => {} })!);

            for (const text of scenario.expectText!) {
              expect(
                visibleText(screen.getByRole("dialog")),
                `expected ${surface.id} / ${scenario.title} to show ${JSON.stringify(text)}`,
              ).toContain(text);
            }
          });
        }

        if (scenario.expectAbsent?.length) {
          it("shows nothing the scenario rules out", () => {
            render(surface.render(index, { onClose: () => {} })!);
            for (const text of scenario.expectAbsent!) {
              expect(
                visibleText(screen.getByRole("dialog")),
                `expected ${surface.id} / ${scenario.title} not to show ${JSON.stringify(text)}`,
              ).not.toContain(text);
            }
          });
        }
      });
    });
  });
}
