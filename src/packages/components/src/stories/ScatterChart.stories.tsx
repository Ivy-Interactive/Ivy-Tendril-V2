import type { Meta, StoryObj } from "@storybook/react";
import { ScatterChart } from "@/components/charts/ScatterChart";
import { SCATTER_DATA, chartDecorator, chartParameters } from "./chart-harness";

const meta: Meta<typeof ScatterChart> = {
  title: "Charts/ScatterChart",
  component: ScatterChart,
  tags: ["autodocs"],
  decorators: [chartDecorator],
  parameters: chartParameters,
  argTypes: {
    colorScheme: { control: "inline-radio", options: ["Default", "Rainbow"] },
  },
};

export default meta;
type Story = StoryObj<typeof ScatterChart>;

// Both axes have to name a data key: a scatter point has no category to fall back on.
export const Default: Story = {
  args: {
    data: SCATTER_DATA,
    scatters: [{ dataKey: "height", name: "Samples" }],
    xAxis: [{ dataKey: "weight" }],
    yAxis: [{ dataKey: "height" }],
  },
};

export const DiamondSymbols: Story = {
  args: {
    data: SCATTER_DATA,
    scatters: [{ dataKey: "height", name: "Samples", shape: "Diamond" }],
    xAxis: [{ dataKey: "weight" }],
    yAxis: [{ dataKey: "height" }],
  },
};

export const WithTrendLine: Story = {
  args: {
    data: SCATTER_DATA,
    scatters: [{ dataKey: "height", name: "Samples", line: true, lineType: "Fitting" }],
    xAxis: [{ dataKey: "weight" }],
    yAxis: [{ dataKey: "height" }],
  },
};
