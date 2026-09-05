import type { Meta, StoryObj } from "@storybook/react";
import { Loading } from "@/components/Loading";

const meta: Meta<typeof Loading> = {
  title: "Domain/Loading",
  component: Loading,
  tags: ["autodocs"],
  argTypes: {
    type: { control: "select", options: ["Spinner", "Skeleton"] },
  },
};

export default meta;
type Story = StoryObj<typeof Loading>;

export const Spinner: Story = {
  args: {
    type: "Spinner",
  },
};

export const Skeleton: Story = {
  args: {
    type: "Skeleton",
  },
};
