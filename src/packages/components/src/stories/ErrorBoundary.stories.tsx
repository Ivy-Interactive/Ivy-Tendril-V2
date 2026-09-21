import type { Meta, StoryObj } from "@storybook/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const BuggyComponent = () => {
  throw new Error("Simulated rendering failure inside child component");
};

const meta: Meta<typeof ErrorBoundary> = {
  title: "Diagnostics/ErrorBoundary",
  component: ErrorBoundary,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

export const CatchingError: Story = {
  render: () => (
    /*
     * A real height, because `ErrorDisplay` is a `h-full` flex column: its stack-trace scroller is
     * bounded by `flex-1 min-h-0`, so it only resolves against a host that has a height of its own.
     * The height has to be large enough to show the fallback, though -- at the previous `h-80`
     * (320px, 346px once this box's own padding and border are counted) the scroller resolved to
     * 117px against a 406px trace, hiding 71% of the very stack trace the story exists to
     * demonstrate and leaving a cut-off line at the bottom edge. `max-w-2xl` widens the box enough
     * that the trace's long unbroken frame URLs wrap into fewer lines, and 32rem then clears the
     * remainder outright: the whole fallback -- type, message, trace and Copy Details -- is visible
     * at once, with the scroller still in place for a trace longer than this one.
     */
    <div className="p-4 max-w-2xl h-[32rem] border rounded-lg">
      <ErrorBoundary>
        <BuggyComponent />
      </ErrorBoundary>
    </div>
  ),
  parameters: {
    // ErrorDisplay renders the caught stack trace through a lazily-loaded syntax highlighter, so the
    // screenshot races between its <pre> fallback and the highlighted result.
    visual: { disable: true },
  },
};
