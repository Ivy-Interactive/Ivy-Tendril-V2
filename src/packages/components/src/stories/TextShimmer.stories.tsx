import type { Meta, StoryObj } from "@storybook/react";
import { TextShimmer } from "@/components/TextShimmer";

const meta: Meta<typeof TextShimmer> = {
  title: "Domain/TextShimmer",
  component: TextShimmer,
  tags: ["autodocs"],
  argTypes: {
    duration: { control: "number" },
    spread: { control: "number" },
  },
};

export default meta;
type Story = StoryObj<typeof TextShimmer>;

export const Default: Story = {
  args: {
    children: "Generating response with AI model...",
    duration: 2,
    spread: 2,
  },
  parameters: {
    // The shimmer is a framer-motion animation driving backgroundPosition directly, not a CSS
    // animation/transition, so the test runner's freeze CSS cannot pin it to one frame.
    visual: { disable: true },
  },
};
