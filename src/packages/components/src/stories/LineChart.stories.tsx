import type { Meta, StoryObj } from "@storybook/react";
import { LineChart } from "@/components/charts/LineChart";
import { MONTHLY_DATA, chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof LineChart> = {
  title: "Charts/LineChart",
  component: LineChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
    layout: { control: "inline-radio", options: ["Horizontal", "Vertical"] },
  },
};

export default meta;
type Story = StoryObj<typeof LineChart>;

export const Default: Story = {
  args: {
    data: MONTHLY_DATA,
  },
};

export const WithLegendAndTooltip: Story = {
  args: {
    data: MONTHLY_DATA,
    legend: { verticalAlign: "Bottom" },
    tooltip: { animated: false },
  },
};

export const SingleSeries: Story = {
  args: {
    data: MONTHLY_DATA,
    lines: [{ dataKey: "revenue", name: "Revenue", curveType: "Natural" }],
  },
};

export const Rainbow: Story = {
  args: {
    data: MONTHLY_DATA,
    colorScheme: "Rainbow",
  },
};
