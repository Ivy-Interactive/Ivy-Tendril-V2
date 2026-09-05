import type { Meta, StoryObj } from "@storybook/react";
import {
  ChatBubble,
  ChatBubbleMessage,
  ChatBubbleAction,
  ChatBubbleActionWrapper,
} from "@/components/ChatBubble";
import { Copy, ThumbsUp, ThumbsDown } from "lucide-react";

const meta: Meta<typeof ChatBubble> = {
  title: "Chat/ChatBubble",
  component: ChatBubble,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ChatBubble>;

export const Conversation: Story = {
  render: () => (
    <div className="flex flex-col gap-4 max-w-xl p-4">
      <ChatBubble variant="sent">
        <ChatBubbleMessage variant="sent">
          Can you review the component porting plan for Ivy Framework?
        </ChatBubbleMessage>
      </ChatBubble>

      <ChatBubble variant="received">
        <div className="flex flex-col">
          <ChatBubbleMessage variant="received">
            The plan is well-structured and all 23+ components are ready to port.
          </ChatBubbleMessage>
          <ChatBubbleActionWrapper>
            <ChatBubbleAction icon={<Copy className="size-3" />} />
            <ChatBubbleAction icon={<ThumbsUp className="size-3" />} />
            <ChatBubbleAction icon={<ThumbsDown className="size-3" />} />
          </ChatBubbleActionWrapper>
        </div>
      </ChatBubble>

      <ChatBubble variant="received">
        <ChatBubbleMessage variant="received" isLoading={true} />
      </ChatBubble>
    </div>
  ),
};
