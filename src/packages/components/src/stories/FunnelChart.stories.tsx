import type { Meta, StoryObj } from "@storybook/react";
import { FunnelChart } from "@/components/charts/FunnelChart";
import {
  CATEGORY_DATA_CUSTOM_KEYS,
  FUNNEL_DATA,
  chartDecorator,
  chartParameters,
} from "./chart-harness";

const meta: Meta<typeof FunnelChart> = {
  title: "Charts/FunnelChart",
  component: FunnelChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
    orientation: { control: "inline-radio", options: ["Vertical", "Horizontal"] },
    sort: { control: "inline-radio", options: ["Descending", "Ascending", "None"] },
  },
};

export default meta;
type Story = StoryObj<typeof FunnelChart>;

export const Default: Story = {
  args: {
    data: FUNNEL_DATA,
  },
};

export const WithLegend: Story = {
  args: {
    data: FUNNEL_DATA,
    legend: { verticalAlign: "Bottom" },
  },
};

/** Arbitrary column names, resolved through the `funnels` entry's `dataKey` and `nameKey`. */
export const CustomKeys: Story = {
  args: {
    data: CATEGORY_DATA_CUSTOM_KEYS,
    funnels: [{ dataKey: "sessions", nameKey: "channel" }],
  },
};

export const Ascending: Story = {
  args: {
    data: FUNNEL_DATA,
    sort: "Ascending",
    gap: 4,
  },
};
