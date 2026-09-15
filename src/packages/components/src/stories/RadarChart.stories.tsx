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

/**
 * One `radars` entry styles every ring, rather than one entry per ring: a radar series carries all
 * the rows, so a second config would repeat them instead of adding a ring.
 */
export const Filled: Story = {
  args: {
    data: RADAR_DATA,
    radars: [{ dataKey: "measure", name: "Score", filled: true }],
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
