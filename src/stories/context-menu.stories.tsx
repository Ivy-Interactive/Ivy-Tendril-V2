import type { Meta, StoryObj } from "@storybook/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const meta: Meta = {
  title: "UI/ContextMenu",
};

export default meta;

export const Default: StoryObj = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed text-sm">
        Right click here
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem inset>Back</ContextMenuItem>
        <ContextMenuItem inset disabled>
          Forward
        </ContextMenuItem>
        <ContextMenuItem inset>Reload</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
