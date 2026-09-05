import type { Meta, StoryObj } from "@storybook/react";
import { StarRating } from "@/components/StarRating";
import { Densities } from "@/types/density";

const meta: Meta<typeof StarRating> = {
  title: "Domain/StarRating",
  component: StarRating,
  tags: ["autodocs"],
  argTypes: {
    value: { control: "number" },
    disabled: { control: "boolean" },
    density: {
      control: "select",
      options: [Densities.Small, Densities.Medium, Densities.Large],
    },
  },
};

export default meta;
type Story = StoryObj<typeof StarRating>;

export const Default: Story = {
  args: {
    value: 3.5,
  },
};
