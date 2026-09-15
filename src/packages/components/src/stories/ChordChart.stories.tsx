import type { Meta, StoryObj } from "@storybook/react";
import { ChordChart } from "@/components/charts/ChordChart";
import { CHORD_DATA, chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof ChordChart> = {
  title: "Charts/ChordChart",
  component: ChordChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
  },
};

export default meta;
type Story = StoryObj<typeof ChordChart>;

export const Default: Story = {
  args: {
    data: CHORD_DATA,
  },
};

export const Sorted: Story = {
  args: {
    data: CHORD_DATA,
    sort: true,
    padAngle: 4,
  },
};

export const Rainbow: Story = {
  args: {
    data: CHORD_DATA,
    colorScheme: "Rainbow",
  },
};
