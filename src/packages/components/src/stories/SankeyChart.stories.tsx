import type { Meta, StoryObj } from "@storybook/react";
import { SankeyChart } from "@/components/charts/SankeyChart";
import { SANKEY_DATA, chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof SankeyChart> = {
  title: "Charts/SankeyChart",
  component: SankeyChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
    nodeAlign: { control: "inline-radio", options: ["Justify", "Left"] },
  },
};

export default meta;
type Story = StoryObj<typeof SankeyChart>;

export const Default: Story = {
  args: {
    data: SANKEY_DATA,
  },
};

export const LeftAligned: Story = {
  args: {
    data: SANKEY_DATA,
    nodeAlign: "Left",
    nodeWidth: 16,
    nodeGap: 12,
  },
};

export const Rainbow: Story = {
  args: {
    data: SANKEY_DATA,
    colorScheme: "Rainbow",
  },
};
