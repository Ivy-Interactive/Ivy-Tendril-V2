import type { Meta, StoryObj } from "@storybook/react";
import { GraphvizRenderer } from "@/components/GraphvizRenderer";

const meta: Meta<typeof GraphvizRenderer> = {
  title: "Renderers/GraphvizRenderer",
  component: GraphvizRenderer,
  tags: ["autodocs"],
  argTypes: {
    content: { control: "text" },
  },
  parameters: {
    // @hpcc-js/wasm-graphviz is fetched and instantiated on first render, so give the layout time to
    // land before the screenshot.
    visual: { settleDelay: 3000 },
  },
};

export default meta;
type Story = StoryObj<typeof GraphvizRenderer>;

export const Digraph: Story = {
  args: {
    content: `digraph G {
    rankdir=LR;
    node [shape=box, style="rounded,filled", fillcolor="#f1f5f9", color="#64748b"];
    Task -> Plan;
    Plan -> Execution;
    Execution -> Verification;
    Verification -> PR;
    PR -> Merge;
  }`,
  },
};
