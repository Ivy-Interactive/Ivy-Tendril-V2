import type { Meta, StoryObj } from "@storybook/react";
import { EmojiRating } from "@/components/EmojiRating";
import { Densities } from "@/types/density";

const meta: Meta<typeof EmojiRating> = {
  title: "Domain/EmojiRating",
  component: EmojiRating,
  tags: ["autodocs"],
  argTypes: {
    value: { control: "number" },
    totalEmojis: { control: "number" },
    allowHalf: { control: "boolean" },
    disabled: { control: "boolean" },
    density: {
      control: "select",
      options: [Densities.Small, Densities.Medium, Densities.Large],
    },
  },
};

export default meta;
type Story = StoryObj<typeof EmojiRating>;

export const Default: Story = {
  args: {
    value: 4,
    allowHalf: true,
  },
};
