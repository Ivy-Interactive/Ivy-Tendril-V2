import type { Meta, StoryObj } from "@storybook/react";
import { Heart, Plus, Settings, Trash2, X } from "lucide-react";
import { IconButton } from "./IconButton";

const meta: Meta<typeof IconButton> = {
  title: "UI/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"] },
    variant: { control: "select", options: ["ghost", "danger", "solid", "outline", "overlay"] },
    shape: { control: "select", options: ["square", "round"] },
    tone: { control: "select", options: ["default", "muted"] },
    active: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {
  args: {
    label: "Settings",
    tooltip: false,
  },
  render: (args) => (
    <IconButton {...args}>
      <Settings size={16} />
    </IconButton>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton label="2xs" tooltip={false} size="2xs">
        <Plus size={12} />
      </IconButton>
      <IconButton label="xs" tooltip={false} size="xs">
        <Plus size={14} />
      </IconButton>
      <IconButton label="sm" tooltip={false} size="sm">
        <Plus size={16} />
      </IconButton>
      <IconButton label="md" tooltip={false} size="md">
        <Plus size={16} />
      </IconButton>
      <IconButton label="lg" tooltip={false} size="lg">
        <Plus size={18} />
      </IconButton>
      <IconButton label="xl" tooltip={false} size="xl">
        <Plus size={20} />
      </IconButton>
      <IconButton label="2xl" tooltip={false} size="2xl" variant="overlay">
        <Plus size={22} />
      </IconButton>
    </div>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-3 rounded-md bg-neutral-800 p-3">
      <IconButton label="Ghost" tooltip={false} variant="ghost">
        <Heart size={16} />
      </IconButton>
      <IconButton label="Danger" tooltip={false} variant="danger">
        <Trash2 size={16} />
      </IconButton>
      <IconButton label="Solid" tooltip={false} variant="solid">
        <Plus size={16} />
      </IconButton>
      <IconButton label="Outline" tooltip={false} variant="outline">
        <Plus size={16} />
      </IconButton>
      <IconButton label="Overlay" tooltip={false} variant="overlay">
        <X size={16} />
      </IconButton>
    </div>
  ),
};

export const RoundShape: Story = {
  args: {
    label: "Attach files",
    tooltip: false,
    shape: "round",
    variant: "outline",
    size: "lg",
  },
  render: (args) => (
    <IconButton {...args}>
      <Plus size={16} />
    </IconButton>
  ),
};

export const ActiveAndTone: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton label="Muted tone" tooltip={false} tone="muted">
        <Settings size={16} />
      </IconButton>
      <IconButton label="Active" tooltip={false} active>
        <Settings size={16} />
      </IconButton>
      <IconButton label="Disabled" tooltip={false} disabled>
        <Settings size={16} />
      </IconButton>
    </div>
  ),
};

export const WithTooltipAndShortcut: Story = {
  args: {
    label: "New plan",
    shortcut: "Ctrl+N",
  },
  render: (args) => (
    <IconButton {...args}>
      <Plus size={16} />
    </IconButton>
  ),
};
