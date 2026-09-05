import type { Meta, StoryObj } from "@storybook/react";
import { Slider } from "@/components/ui/slider";

const meta: Meta<typeof Slider> = {
  title: "UI/Slider",
  component: Slider,
};

export default meta;

export const Default: StoryObj<typeof Slider> = {
  render: () => (
    <div className="w-[300px]">
      <Slider defaultValue={[50]} max={100} step={1} />
    </div>
  ),
};
