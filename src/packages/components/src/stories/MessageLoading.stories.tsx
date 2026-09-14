import type { Meta, StoryObj } from "@storybook/react";
import { MessageLoading } from "@/components/MessageLoading";

const meta: Meta<typeof MessageLoading> = {
  title: "Chat/MessageLoading",
  component: MessageLoading,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MessageLoading>;

export const Default: Story = {
  render: () => (
    <div className="p-4 bg-muted rounded-md inline-block">
      <MessageLoading />
    </div>
  ),
};
