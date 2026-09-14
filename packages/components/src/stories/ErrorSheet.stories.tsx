import type { Meta, StoryObj } from "@storybook/react";
import { ErrorSheet } from "@/components/ErrorSheet";
import { showError } from "@/hooks/use-error-sheet";
import { Button } from "@/components/ui/button";

const meta: Meta<typeof ErrorSheet> = {
  title: "Diagnostics/ErrorSheet",
  component: ErrorSheet,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ErrorSheet>;

export const Interactive: Story = {
  render: () => (
    <div className="p-4">
      <Button
        onClick={() => {
          showError({
            title: "NetworkTimeoutException",
            message: "Failed to fetch remote repository status within 30000ms.",
            stackTrace: "at Ivy.Network.HttpTransport.SendAsync()\nat Ivy.Client.Fetch()",
          });
        }}
      >
        Trigger Error Sheet
      </Button>
      <ErrorSheet />
    </div>
  ),
};
