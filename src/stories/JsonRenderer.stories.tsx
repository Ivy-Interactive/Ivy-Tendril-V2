import type { Meta, StoryObj } from "@storybook/react";
import { JsonRenderer } from "@/components/JsonRenderer";

const sampleData = {
  name: "components-storybook",
  version: "1.0.0",
  active: true,
  count: 42,
  tags: ["react", "ui", "tailwind"],
  nested: {
    author: {
      name: "SpaceCorps",
      email: "team@spacecorps.io",
    },
    metrics: [
      { id: 1, score: 98.5 },
      { id: 2, score: 99.1 },
    ],
  },
};

const meta: Meta<typeof JsonRenderer> = {
  title: "Renderers/JsonRenderer",
  component: JsonRenderer,
  tags: ["autodocs"],
  argTypes: {
    initialExpanded: { control: "number" },
  },
};

export default meta;
type Story = StoryObj<typeof JsonRenderer>;

export const Default: Story = {
  args: {
    data: sampleData,
    initialExpanded: 2,
  },
};
