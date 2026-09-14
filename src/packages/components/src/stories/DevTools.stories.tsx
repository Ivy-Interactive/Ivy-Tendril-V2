import type { Meta, StoryObj } from "@storybook/react";
import { DevTools } from "@/components/DevTools";

const meta: Meta<typeof DevTools> = {
  title: "Diagnostics/DevTools",
  component: DevTools,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DevTools>;

export const Default: Story = {
  render: () => (
    <div className="p-4">
      <p className="text-sm text-muted-foreground">
        DevTools listens to window messages (<code>DEVTOOLS_SET_ENABLED</code>) to activate element
        selection overlays.
      </p>
      <div
        id="sample-widget"
        data-ivy-widget-id="sample-1"
        data-ivy-widget-type="Ivy.TextBlock"
        className="p-4 border rounded mt-4"
      >
        Sample Widget Target
      </div>
      <DevTools />
    </div>
  ),
};
