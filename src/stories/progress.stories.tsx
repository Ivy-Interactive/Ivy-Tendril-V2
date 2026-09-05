import type { Meta, StoryObj } from "@storybook/react";
import { Progress } from "@/components/ui/progress";

const meta: Meta<typeof Progress> = {
  title: "UI/Progress",
  component: Progress,
};

export default meta;

export const Default: StoryObj<typeof Progress> = {
  render: () => (
    <div className="flex flex-col gap-4 w-[60%]">
      <Progress value={33} />
      <Progress value={66} />
      <Progress value={100} />
      <Progress value={null} />
    </div>
  ),
};
