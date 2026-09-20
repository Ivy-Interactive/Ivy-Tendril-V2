import type { Meta, StoryObj } from "@storybook/react";
import { TuiKbd } from "./TuiKbd";

const meta: Meta<typeof TuiKbd> = {
  title: "UI/TuiKbd",
  component: TuiKbd,
  tags: ["autodocs"],
  argTypes: {
    keys: { control: "text" },
    variant: { control: "select", options: ["bare", "boxed", "outline"] },
    size: { control: "select", options: ["sm", "md", "lg"] },
    platform: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof TuiKbd>;

export const Boxed: Story = {
  args: {
    keys: "Ctrl+K",
    variant: "boxed",
  },
};

export const Bare: Story = {
  args: {
    keys: "Ctrl+K",
    variant: "bare",
  },
};

export const Outline: Story = {
  args: {
    keys: "Ctrl+Enter",
    variant: "outline",
  },
};

export const Platform: Story = {
  args: {
    keys: "Ctrl+Enter",
    variant: "outline",
    platform: true,
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <TuiKbd keys="K" variant="boxed" size="sm" />
      <TuiKbd keys="K" variant="boxed" size="md" />
      <TuiKbd keys="K" variant="boxed" size="lg" />
    </div>
  ),
};
