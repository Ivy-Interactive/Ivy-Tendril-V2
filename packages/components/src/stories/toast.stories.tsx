import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";

const meta: Meta = {
  title: "UI/Toast",
};

export default meta;

const ToastDemo = () => {
  const { toast } = useToast();
  return (
    <div>
      <Button
        variant="outline"
        onClick={() => {
          toast({
            title: "Scheduled: Catch up",
            description: "Friday, February 10, 2026 at 5:57 PM",
          });
        }}
      >
        Show Toast
      </Button>
      <Toaster />
    </div>
  );
};

export const Default: StoryObj = {
  render: () => <ToastDemo />,
};
