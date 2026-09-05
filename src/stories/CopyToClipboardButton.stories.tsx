import type { Meta, StoryObj } from "@storybook/react";
import { CopyToClipboardButton } from "@/components/CopyToClipboardButton";
import { Densities } from "@/types/density";

const meta: Meta<typeof CopyToClipboardButton> = {
  title: "Domain/CopyToClipboardButton",
  component: CopyToClipboardButton,
  tags: ["autodocs"],
  argTypes: {
    textToCopy: { control: "text" },
    label: { control: "text" },
    density: {
      control: "select",
      options: [Densities.Small, Densities.Medium, Densities.Large],
    },
  },
};

export default meta;
type Story = StoryObj<typeof CopyToClipboardButton>;

export const IconOnly: Story = {
  args: {
    textToCopy: "npm install @ivy-framework/components",
  },
};

export const WithLabel: Story = {
  args: {
    textToCopy: "git clone https://github.com/Ivy-Interactive/ivy-framework.git",
    label: "Copy Repository URL",
  },
};
