import type { Meta, StoryObj } from "@storybook/react";
import { Kbd, ShortcutKeys } from "@/components/Kbd";

const meta: Meta<typeof Kbd> = {
  title: "Domain/Kbd",
  component: Kbd,
  tags: ["autodocs"],
  argTypes: {
    keys: { control: "text" },
    ghost: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Kbd>;

export const Default: Story = {
  args: {
    children: "K",
    ghost: false,
  },
};

export const Shortcuts: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span>Command Palette:</span>
        <ShortcutKeys shortcut="Ctrl+K" />
      </div>
      <div className="flex items-center gap-2">
        <span>Format Code:</span>
        <ShortcutKeys shortcut="Shift+Alt+F" />
      </div>
      <div className="flex items-center gap-2">
        <span>Quick Open:</span>
        <ShortcutKeys shortcut="Cmd+P" />
      </div>
    </div>
  ),
};
