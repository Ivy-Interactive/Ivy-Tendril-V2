import type { Meta, StoryObj } from "@storybook/react";
import { Flag } from "lucide-react";
import { CountBadge, StatusDot, TuiBadge } from "./TuiBadge";

const meta: Meta<typeof TuiBadge> = {
  title: "UI/TuiBadge",
  component: TuiBadge,
  tags: ["autodocs"],
  argTypes: {
    kind: {
      control: "select",
      options: ["neutral", "primary", "project", "success", "warning", "danger", "color"],
    },
    size: { control: "select", options: [undefined, "sm", "md"] },
    shape: { control: "select", options: [undefined, "rounded", "pill"] },
    numeric: { control: "boolean" },
    floating: { control: "boolean" },
    mono: { control: "boolean" },
    caps: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof TuiBadge>;

export const Kinds: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <TuiBadge kind="neutral">Neutral</TuiBadge>
      <TuiBadge kind="primary">Primary</TuiBadge>
      <TuiBadge kind="project">Project</TuiBadge>
      <TuiBadge kind="success">Success</TuiBadge>
      <TuiBadge kind="warning">Warning</TuiBadge>
      <TuiBadge kind="danger">Danger</TuiBadge>
      <TuiBadge color="Blue">Color</TuiBadge>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <TuiBadge size="sm">Small</TuiBadge>
      <TuiBadge size="md">Medium</TuiBadge>
    </div>
  ),
};

export const ShapeAndModifiers: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <TuiBadge shape="pill">Pill</TuiBadge>
      <TuiBadge shape="rounded">Rounded</TuiBadge>
      <TuiBadge mono size="md">
        SHA-1234
      </TuiBadge>
      <TuiBadge caps>doc</TuiBadge>
      <TuiBadge icon={<Flag size={10} />}>Flagged</TuiBadge>
    </div>
  ),
};

export const Numeric: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <TuiBadge numeric>3</TuiBadge>
      <TuiBadge numeric kind="danger">
        12
      </TuiBadge>
    </div>
  ),
};

export const Removable: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <TuiBadge size="md" onRemove={() => {}} removeLabel="Remove tag">
        Removable
      </TuiBadge>
    </div>
  ),
};

export const Floating: Story = {
  render: () => (
    <div className="relative inline-flex size-8 items-center justify-center rounded-md bg-neutral-800">
      <Flag size={16} className="text-white" />
      <TuiBadge kind="primary" size="sm" floating numeric>
        3
      </TuiBadge>
    </div>
  ),
};

export const CountBadgeStory: StoryObj<typeof CountBadge> = {
  name: "CountBadge",
  render: () => (
    <div className="flex items-center gap-2">
      <CountBadge count={0} />
      <CountBadge count={7} />
      <CountBadge count={150} />
    </div>
  ),
};

export const StatusDotStory: StoryObj<typeof StatusDot> = {
  name: "StatusDot",
  render: () => (
    <div className="flex items-center gap-3">
      <StatusDot tone="neutral" />
      <StatusDot tone="success" />
      <StatusDot tone="warning" pulse />
      <StatusDot tone="danger" />
      <div className="relative inline-flex size-8 items-center justify-center rounded-md bg-neutral-800">
        <Flag size={16} className="text-white" />
        <StatusDot tone="warning" floating />
      </div>
    </div>
  ),
};
