import type * as React from "react";

/**
 * One permutation of one dialog: a title, why it exists, and a complete model.
 *
 * Ported from V1's `Apps/Debug/DirtyRepoDialogDebugView.cs`, which declares a `DirtyScenario`
 * record per permutation and opens the real dialog with it. Two things are kept from that design
 * and one is added.
 *
 * Kept: **the model is complete and real**. A scenario passes the props the dialog actually takes,
 * never a partial fixture or a mock, so what the harness shows is what the dialog does. And
 * **`hint` says what the permutation is for** — V1 renders it under the button, because "single
 * repo, many changes" does not tell you it exists to exercise the truncation cap.
 *
 * Added: `expectText` / `expectAbsent`. V1's harness was visual only, so it caught what somebody
 * remembered to look at. Declaring the claim as *data* lets `tests/dialog-scenarios.test.tsx` check
 * every scenario in CI while keeping this file free of any test-only import — app source must not
 * reach for `@testing-library/react`, and a callback taking a `screen` would have forced it to.
 */
export interface Scenario<P> {
  /** Shown in the harness, and used as the test name. Unique within its surface. */
  title: string;
  /** What this permutation is for. One sentence, naming the branch it exercises. */
  hint: string;
  /** The complete props for this permutation, minus `isOpen`/`onClose` which the host supplies. */
  props: Omit<P, "isOpen" | "onClose">;
  /** Text that must be present once this scenario renders. Matched as a substring. */
  expectText?: string[];
  /** Text that must NOT be present. Guards copy that should only appear in a sibling scenario. */
  expectAbsent?: string[];
}

export type SurfaceKind = "dialog" | "sheet";

/** What the host supplies, so a scenario never has to fake a close handler. */
export interface SurfaceHostProps {
  onClose: () => void;
}

/**
 * A registered surface with its props type erased.
 *
 * The registry is a heterogeneous list — every catalog has its own props type — so entries are
 * built through {@link defineSurface}, which keeps each catalog type-checked against its own
 * component and hands back this uniform shape for the two consumers to walk.
 */
export interface Surface {
  id: string;
  kind: SurfaceKind;
  /** Scenario metadata, with `props` erased. Enough for both consumers to list and name them. */
  scenarios: ReadonlyArray<Omit<Scenario<unknown>, "props">>;
  /** Builds the real component for one scenario, open, with the host's close handler. */
  render: (index: number, host: SurfaceHostProps) => React.ReactElement | null;
}

/**
 * Registers one surface's catalog.
 *
 * `Component` is the real dialog, not a wrapper: the whole point is that the harness and the test
 * suite exercise the shipped component. The `isOpen`/`onClose` pair is supplied here rather than
 * per scenario, so a catalog cannot accidentally declare a scenario that renders closed.
 */
export function defineSurface<P extends { isOpen: boolean; onClose: () => void }>(
  id: string,
  kind: SurfaceKind,
  Component: React.ComponentType<P>,
  scenarios: ReadonlyArray<Scenario<P>>,
): Surface {
  return {
    id,
    kind,
    scenarios: scenarios.map(({ title, hint, expectText, expectAbsent }) => ({
      title,
      hint,
      expectText,
      expectAbsent,
    })),
    render: (index, host) => {
      const scenario = scenarios[index];
      if (!scenario) return null;
      const props = {
        ...(scenario.props as object),
        isOpen: true,
        onClose: host.onClose,
      } as unknown as P;
      // `key` forces a fresh mount per scenario. Several dialogs seed their fields once per
      // opening rather than on prop identity - `CreateIssueDialog` deliberately so, because its
      // callers rebuild `subject` and `projectRepos` every render - so re-rendering the same
      // element with different props would leave the previous scenario's field values on screen.
      return <Component key={`${id}:${index}`} {...props} />;
    },
  };
}
