import type { Meta, StoryObj } from "@storybook/react";
import { LogoLoading } from "@/components/LogoLoading";

const meta: Meta<typeof LogoLoading> = {
  title: "Domain/LogoLoading",
  component: LogoLoading,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof LogoLoading>;

export const Default: Story = {
  render: () => (
    <div className="p-8 flex items-center justify-center">
      <LogoLoading />
    </div>
  ),
};
