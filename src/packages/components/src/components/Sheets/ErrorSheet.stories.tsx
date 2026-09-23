import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { ErrorSheet } from "./ErrorSheet";
import { showError } from "../../hooks/use-error-sheet";

/**
 * The error sheet, which is the odd one of the three: it takes no props at all.
 *
 * It subscribes to the `useErrorSheet` store and renders one sheet per error pushed into it, so
 * there is nothing to pass and nothing to open directly — the trigger has to be `showError`, which
 * is exactly how the app raises one. That also makes it the only sheet here that can be on screen
 * more than once, so the stacking case is worth looking at rather than assuming.
 *
 * Left in `components/ErrorSheet.tsx` rather than moved into this folder: it is already exported
 * from the package root and moving it would churn call sites for a story's benefit.
 */
const meta: Meta<typeof ErrorSheet> = {
  title: "Sheets/ErrorSheet",
  component: ErrorSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof ErrorSheet>;

function Trigger({ label, onRaise }: { label: string; onRaise: () => void }) {
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" onClick={onRaise} data-testid="error-story-trigger">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">
        Raises an error through `showError`, the same call the app makes. Press it twice to see two
        stack.
      </p>
      <ErrorSheet />
    </div>
  );
}

/** A plain failure: a title and a message, which is most of what the app raises. */
export const SimpleError: Story = {
  render: () => (
    <Trigger
      label="Raise an error"
      onRaise={() =>
        showError({
          title: "Could not start the job",
          message: "Plan 00412 is held by a running job (#1184).",
        })
      }
    />
  ),
};

/**
 * With a stack trace, which is the case the sheet exists for — a toast cannot hold one, and this is
 * where the operator goes to copy it into a bug report.
 */
export const WithStackTrace: Story = {
  render: () => (
    <Trigger
      label="Raise an error with a stack"
      onRaise={() =>
        showError({
          title: "Unhandled exception in the plan watcher",
          message: "called `Option::unwrap()` on a `None` value",
          stackTrace: [
            "thread 'tokio-runtime-worker' panicked at crates/tendril-core/src/plans/reader.rs:58",
            "   0: tendril_core::plans::reader::read_plan_file",
            "   1: tendril_core::watcher::resync::resync_plan",
            "   2: tendril_core::watcher::run::watch_loop::{{closure}}",
            "   3: tokio::runtime::task::harness::poll_future",
            "   4: tokio::runtime::scheduler::multi_thread::worker::run_task",
            "note: run with `RUST_BACKTRACE=full` for a verbose backtrace",
          ].join("\n"),
        })
      }
    />
  ),
};

/** A long message with no stack — whether the body wraps rather than pushing the panel wide. */
export const LongMessage: Story = {
  render: () => (
    <Trigger
      label="Raise a long error"
      onRaise={() =>
        showError({
          title: "Verification failed",
          message:
            "RustClippy denied 2 warnings in tendril-core::agents::providers: unused variable `spec` at providers.rs:812, and needless borrow at providers.rs:947. The job ran to completion and its worktree is intact, so the fastest way through is to run `cargo clippy --all-targets` in the plan's worktree and fix both in place rather than retrying the whole plan.",
        })
      }
    />
  ),
};
