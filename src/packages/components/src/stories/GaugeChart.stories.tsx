import type { Meta, StoryObj } from "@storybook/react";
import { GaugeChart } from "@/components/charts/GaugeChart";
import { chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof GaugeChart> = {
  title: "Charts/GaugeChart",
  component: GaugeChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    value: { control: { type: "range", min: 0, max: 100, step: 1 } },
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
  },
};

export default meta;
type Story = StoryObj<typeof GaugeChart>;

export const Default: Story = {
  args: {
    value: 68,
    label: "Coverage",
  },
};

export const WithThresholds: Story = {
  args: {
    value: 82,
    label: "Utilisation",
    thresholds: [
      { value: 50, color: "#047857" },
      { value: 80, color: "#b45309" },
      { value: 100, color: "#b91c1c" },
    ],
  },
};

export const CustomRange: Story = {
  args: {
    value: 320,
    min: 0,
    max: 500,
    label: "Requests/s",
    pointer: { style: "Arrow", width: 6 },
  },
};
