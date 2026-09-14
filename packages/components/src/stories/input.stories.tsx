import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "@/components/ui/input";

const meta: Meta<typeof Input> = {
  title: "UI/Input",
  component: Input,
};

export default meta;

export const Default: StoryObj<typeof Input> = {
  render: () => (
    <div className="flex flex-col gap-4 w-[350px]">
      <Input placeholder="Default Input" />
      <Input placeholder="Disabled Input" disabled />
      <Input type="email" placeholder="Email" />
      <Input type="password" placeholder="Password" />
    </div>
  ),
};
