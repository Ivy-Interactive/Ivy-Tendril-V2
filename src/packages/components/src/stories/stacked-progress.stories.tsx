import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { StackedProgress } from "@/components/ui/stacked-progress";
import { Densities } from "@/types/density";

const meta: Meta<typeof StackedProgress> = {
  title: "UI/StackedProgress",
  component: StackedProgress,
};

export default meta;
type Story = StoryObj<typeof StackedProgress>;

const usage = [
  { value: 45, label: "Used", color: "primary" as const },
  { value: 25, label: "Cached", color: "info" as const },
  { value: 30, label: "Free", color: "muted" as const },
];

export const Default: Story = {
  render: () => (
    <div className="w-[520px]">
      <StackedProgress segments={usage} aria-label="Disk usage" />
    </div>
  ),
};

export const WithLabels: Story = {
  render: () => (
    <div className="w-[520px]">
      <StackedProgress segments={usage} showLabels aria-label="Disk usage" />
    </div>
  ),
};

export const Indeterminate: Story = {
  render: () => (
    <div className="w-[520px]">
      <StackedProgress
        segments={[
          { value: 4, label: "Completed", color: "success" },
          { value: 0, label: "Running", color: "info", indeterminate: true },
        ]}
        showLabels
        aria-label="Verification progress"
      />
    </div>
  ),
};

export const Selectable: Story = {
  render: function SelectableStory() {
    const [selected, setSelected] = React.useState(0);
    return (
      <div className="w-[520px]">
        <StackedProgress
          segments={usage}
          selected={selected}
          onSelect={setSelected}
          showLabels
          barHeight={12}
          aria-label="Disk usage"
        />
      </div>
    );
  },
};

export const Empty: Story = {
  render: () => (
    <div className="w-[520px]">
      <StackedProgress segments={[]} aria-label="Disk usage" />
    </div>
  ),
};

export const StackedProgressDensities: Story = {
  name: "Densities",
  render: () => (
    <div className="flex w-[520px] flex-col gap-6">
      {[Densities.Small, Densities.Medium, Densities.Large].map((density) => (
        <StackedProgress
          key={density}
          segments={usage}
          showLabels
          density={density}
          aria-label={`Disk usage (${density})`}
        />
      ))}
    </div>
  ),
};

export const JobPhases: Story = {
  render: () => (
    <div className="w-[520px]">
      <StackedProgress
        segments={[
          { value: 6, label: "Passed", color: "success" },
          { value: 1, label: "Failed", color: "destructive" },
          { value: 1, label: "Running", color: "info", indeterminate: true },
          { value: 4, label: "Queued", color: "muted" },
        ]}
        total={12}
        showLabels
        barHeight={10}
        aria-label="Job phase progress"
      />
    </div>
  ),
};
