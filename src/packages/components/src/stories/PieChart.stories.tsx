import type { Meta, StoryObj } from "@storybook/react";
import { PieChart } from "@/components/charts/PieChart";
import {
  CATEGORY_DATA,
  CATEGORY_DATA_CUSTOM_KEYS,
  chartDecorator,
  chartParameters,
} from "./chart-harness";

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
    pies: [{ dataKey: "measure", nameKey: "dimension", innerRadius: "45%", outerRadius: "70%" }],
    legend: { verticalAlign: "Bottom" },
  },
};

export const WithTotal: Story = {
  args: {
    data: CATEGORY_DATA,
    pies: [{ dataKey: "measure", nameKey: "dimension", innerRadius: "50%", outerRadius: "72%" }],
    total: { label: "Sessions", formattedValue: "11,800" },
  },
};

/** Arbitrary column names, resolved through the `pies` entry's `dataKey` and `nameKey`. */
export const CustomKeys: Story = {
  args: {
    data: CATEGORY_DATA_CUSTOM_KEYS,
    pies: [{ dataKey: "sessions", nameKey: "channel" }],
    legend: { verticalAlign: "Bottom" },
  },
};

export const Rainbow: Story = {
  args: {
    data: CATEGORY_DATA,
    colorScheme: "Rainbow",
  },
};
