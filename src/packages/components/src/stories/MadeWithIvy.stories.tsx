import type { Meta, StoryObj } from "@storybook/react";
import { MadeWithIvy } from "@/components/MadeWithIvy";

const meta: Meta<typeof MadeWithIvy> = {
  title: "Domain/MadeWithIvy",
  component: MadeWithIvy,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MadeWithIvy>;

export const Default: Story = {
  render: () => (
    <div className="relative h-64 border rounded-lg p-4 overflow-hidden">
      <p className="text-muted-foreground">
        Look in bottom right corner (requires screen size at least 600px)
      </p>
      <MadeWithIvy />
    </div>
  ),
};
