import type { Meta, StoryObj } from "@storybook/react";
import { Toggle } from "@/components/ui/toggle";
import { Bold, Italic } from "lucide-react";

const meta: Meta<typeof Toggle> = {
  title: "UI/Toggle",
  component: Toggle,
};

export default meta;

export const Default: StoryObj<typeof Toggle> = {
  render: () => (
    <div className="flex gap-2">
      <Toggle aria-label="Toggle bold">
        <Bold className="h-4 w-4" />
      </Toggle>
      <Toggle aria-label="Toggle italic">
        <Italic className="h-4 w-4" />
      </Toggle>
    </div>
  ),
};
