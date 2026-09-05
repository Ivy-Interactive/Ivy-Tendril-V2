import type { Meta, StoryObj } from "@storybook/react";
import { ChatInput } from "@/components/ChatInput";

const meta: Meta<typeof ChatInput> = {
  title: "Chat/ChatInput",
  component: ChatInput,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ChatInput>;

export const Default: Story = {
  args: {
    placeholder: "Type a message...",
  },
};
