import type { Meta, StoryObj } from "@storybook/react";
import { PieChart } from "@/components/charts/PieChart";
import { CATEGORY_DATA, chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof PieChart> = {
  title: "Charts/PieChart",
  component: PieChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
  },
};

export default meta;
type Story = StoryObj<typeof PieChart>;

export const Default: Story = {
  args: {
    data: CATEGORY_DATA,
  },
};

export const Donut: Story = {
  args: {
    data: CATEGORY_DATA,
    pies: [{ dataKey: "value", nameKey: "category", innerRadius: "45%", outerRadius: "70%" }],
    legend: { verticalAlign: "Bottom" },
  },
};

export const WithTotal: Story = {
  args: {
    data: CATEGORY_DATA,
    pies: [{ dataKey: "value", nameKey: "category", innerRadius: "50%", outerRadius: "72%" }],
    total: { label: "Sessions", formattedValue: "11,800" },
  },
};

export const Rainbow: Story = {
  args: {
    data: CATEGORY_DATA,
    colorScheme: "Rainbow",
  },
};
