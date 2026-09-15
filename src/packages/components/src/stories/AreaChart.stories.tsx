import type { Meta, StoryObj } from "@storybook/react";
import { AreaChart } from "@/components/charts/AreaChart";
import { MONTHLY_DATA, chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof AreaChart> = {
  title: "Charts/AreaChart",
  component: AreaChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
  },
};

export default meta;
type Story = StoryObj<typeof AreaChart>;

export const Default: Story = {
  args: {
    data: MONTHLY_DATA,
  },
};

export const Stacked: Story = {
  args: {
    data: MONTHLY_DATA,
    areas: [
      { dataKey: "costs", name: "Costs", stackId: "total" },
      { dataKey: "profit", name: "Profit", stackId: "total" },
    ],
    legend: { verticalAlign: "Bottom" },
  },
};

export const SmoothSingleSeries: Story = {
  args: {
    data: MONTHLY_DATA,
    areas: [{ dataKey: "revenue", name: "Revenue", curveType: "Natural" }],
  },
};
