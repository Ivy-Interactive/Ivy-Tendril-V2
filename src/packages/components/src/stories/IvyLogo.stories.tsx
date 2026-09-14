import type { Meta, StoryObj } from "@storybook/react";
import { IvyLogo } from "@/components/IvyLogo";

const meta: Meta<typeof IvyLogo> = {
  title: "Domain/IvyLogo",
  component: IvyLogo,
  tags: ["autodocs"],
  argTypes: {
    className: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof IvyLogo>;

export const Default: Story = {
  args: {
    className: "w-12 h-12 text-primary",
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6 text-primary">
      <IvyLogo className="w-6 h-6" />
      <IvyLogo className="w-10 h-10" />
      <IvyLogo className="w-16 h-16" />
    </div>
  ),
};
