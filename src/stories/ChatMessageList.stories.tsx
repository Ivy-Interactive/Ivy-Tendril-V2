import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessageList } from "@/components/ChatMessageList";
import { ChatBubble, ChatBubbleMessage } from "@/components/ChatBubble";

const meta: Meta<typeof ChatMessageList> = {
  title: "Chat/ChatMessageList",
  component: ChatMessageList,
  tags: ["autodocs"],
  argTypes: {
    enableAutoScroll: { control: "boolean" },
    showScrollButton: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof ChatMessageList>;

export const Default: Story = {
  render: () => (
    <div className="h-80 border rounded-lg overflow-hidden bg-background">
      <ChatMessageList smooth={true}>
        {Array.from({ length: 12 }).map((_, i) => (
          <ChatBubble key={i} variant={i % 2 === 0 ? "received" : "sent"}>
            <ChatBubbleMessage variant={i % 2 === 0 ? "received" : "sent"}>
              {i % 2 === 0
                ? `System message #${i + 1}: Automated status update.`
                : `User reply #${i + 1}: Understood, proceeding.`}
            </ChatBubbleMessage>
          </ChatBubble>
        ))}
      </ChatMessageList>
    </div>
  ),
};
