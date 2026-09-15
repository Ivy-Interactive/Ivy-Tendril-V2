import type { Meta, StoryObj } from "@storybook/react";
import { BarChart } from "@/components/charts/BarChart";
import { MONTHLY_DATA, chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof BarChart> = {
  title: "Charts/BarChart",
  component: BarChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
    layout: { control: "inline-radio", options: ["Horizontal", "Vertical"] },
  },
};

export default meta;
type Story = StoryObj<typeof BarChart>;

export const Default: Story = {
  args: {
    data: MONTHLY_DATA,
    bars: [
      { dataKey: "revenue", name: "Revenue" },
      { dataKey: "costs", name: "Costs" },
    ],
    legend: { verticalAlign: "Bottom" },
  },
};

export const Stacked: Story = {
  args: {
    data: MONTHLY_DATA,
    bars: [
      { dataKey: "costs", name: "Costs", stackId: "total" },
      { dataKey: "profit", name: "Profit", stackId: "total" },
    ],
    legend: { verticalAlign: "Bottom" },
  },
};

export const Horizontal: Story = {
  args: {
    data: MONTHLY_DATA,
    bars: [{ dataKey: "revenue", name: "Revenue" }],
    layout: "Horizontal",
  },
};

export const Rounded: Story = {
  args: {
    data: MONTHLY_DATA,
    bars: [{ dataKey: "revenue", name: "Revenue", radius: [4, 4, 0, 0] }],
  },
};
