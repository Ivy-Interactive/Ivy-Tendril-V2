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
    <div className="p-4 max-w-xl h-80 border rounded-lg">
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
