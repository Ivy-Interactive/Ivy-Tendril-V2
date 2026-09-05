import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "@/components/ui/textarea";

const meta: Meta<typeof Textarea> = {
  title: "UI/Textarea",
  component: Textarea,
};

export default meta;

export const Default: StoryObj<typeof Textarea> = {
  render: () => (
    <div className="w-[400px]">
      <Textarea placeholder="Type your message here." />
    </div>
  ),
};
