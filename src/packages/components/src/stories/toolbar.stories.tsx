import type { Meta, StoryObj } from "@storybook/react";
import { Bold, Italic, Redo2, Save, Trash2, Underline, Undo2 } from "lucide-react";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarToggleButton,
} from "@/components/ui/toolbar";
import { Badge } from "@/components/ui/badge";
import { Densities } from "@/types/density";

const meta: Meta<typeof Toolbar> = {
  title: "UI/Toolbar",
  component: Toolbar,
};

export default meta;
type Story = StoryObj<typeof Toolbar>;

export const Default: Story = {
  render: () => (
    <Toolbar aria-label="Plan actions">
      <ToolbarButton icon={<Undo2 />} label="Undo" />
      <ToolbarButton icon={<Redo2 />} label="Redo" />
      <ToolbarButton icon={<Save />} label="Save" />
    </Toolbar>
  ),
};

export const WithGroupsAndSeparators: Story = {
  render: () => (
    <Toolbar aria-label="Plan actions">
      <ToolbarGroup aria-label="History">
        <ToolbarButton icon={<Undo2 />} label="Undo" />
        <ToolbarButton icon={<Redo2 />} label="Redo" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Document">
        <ToolbarButton icon={<Save />} label="Save" />
        <ToolbarButton icon={<Trash2 />} label="Delete" />
      </ToolbarGroup>
    </Toolbar>
  ),
};

export const IconOnlyWithTooltips: Story = {
  render: () => (
    <Toolbar aria-label="Formatting">
      <ToolbarButton icon={<Bold />} tooltip="Bold" />
      <ToolbarButton icon={<Italic />} tooltip="Italic" />
      <ToolbarButton icon={<Underline />} tooltip="Underline" />
      <ToolbarSeparator />
      <ToolbarButton icon={<Trash2 />} tooltip="Delete" disabled />
    </Toolbar>
  ),
};

export const Compact: Story = {
  // `Densities.Small` *is* the compact density — there is no separate `compact` prop.
  render: () => (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Densities.Small is the compact density: tighter gaps, padding and control sizes.
      </p>
      <Toolbar aria-label="Plan actions" density={Densities.Small}>
        <ToolbarGroup aria-label="History">
          <ToolbarButton icon={<Undo2 />} tooltip="Undo" />
          <ToolbarButton icon={<Redo2 />} tooltip="Redo" />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarButton icon={<Save />} tooltip="Save" />
      </Toolbar>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Toolbar aria-label="Plan actions" disabled>
      <ToolbarButton icon={<Undo2 />} label="Undo" />
      <ToolbarButton icon={<Redo2 />} label="Redo" />
      <ToolbarButton icon={<Save />} label="Save" />
    </Toolbar>
  ),
};

export const Overflow: Story = {
  render: () => (
    <div className="w-[280px]">
      <Toolbar aria-label="Plan actions" overflow="menu">
        <ToolbarButton icon={<Undo2 />} label="Undo" />
        <ToolbarButton icon={<Redo2 />} label="Redo" />
        <ToolbarSeparator />
        <ToolbarButton icon={<Save />} label="Save" />
        <ToolbarButton icon={<Trash2 />} label="Delete" />
      </Toolbar>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <Toolbar aria-label="Plan actions" orientation="vertical" className="w-fit">
      <ToolbarButton icon={<Undo2 />} tooltip="Undo" />
      <ToolbarButton icon={<Redo2 />} tooltip="Redo" />
      <ToolbarSeparator />
      <ToolbarButton icon={<Save />} tooltip="Save" />
    </Toolbar>
  ),
};

export const LeadingAndTrailing: Story = {
  render: () => (
    <div className="w-[560px]">
      <Toolbar
        aria-label="Plan actions"
        leading={<span className="px-2 text-sm font-medium">Revision 003</span>}
        trailing={<Badge variant="secondary">Draft</Badge>}
      >
        <ToolbarGroup aria-label="Formatting">
          <ToolbarToggleButton icon={<Bold />} tooltip="Bold" pressed />
          <ToolbarToggleButton icon={<Italic />} tooltip="Italic" />
        </ToolbarGroup>
      </Toolbar>
    </div>
  ),
};
