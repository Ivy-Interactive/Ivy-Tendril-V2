import type { Meta, StoryObj } from "@storybook/react";
import { RadarChart } from "@/components/charts/RadarChart";
import { RADAR_DATA, chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof RadarChart> = {
  title: "Charts/RadarChart",
  component: RadarChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
    shape: { control: "inline-radio", options: ["Polygon", "Circle"] },
  },
};

export default meta;
type Story = StoryObj<typeof RadarChart>;

export const Default: Story = {
  args: {
    data: RADAR_DATA,
  },
};

export const TwoSeriesFilled: Story = {
  args: {
    data: RADAR_DATA,
    radars: [
      { dataKey: "current", name: "Current", filled: true },
      { dataKey: "target", name: "Target" },
    ],
    legend: { verticalAlign: "Bottom" },
  },
};

export const CircularShape: Story = {
  args: {
    data: RADAR_DATA,
    shape: "Circle",
    splitArea: true,
  },
};
