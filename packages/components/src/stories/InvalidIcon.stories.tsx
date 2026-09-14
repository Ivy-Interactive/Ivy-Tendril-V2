import type { Meta, StoryObj } from "@storybook/react";
import { InvalidIcon } from "@/components/InvalidIcon";

const meta: Meta<typeof InvalidIcon> = {
  title: "Domain/InvalidIcon",
  component: InvalidIcon,
  tags: ["autodocs"],
  argTypes: {
    message: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof InvalidIcon>;

export const Default: Story = {
  args: {
    message: "This value is required and cannot be empty.",
  },
};
