import type { Meta, StoryObj } from "@storybook/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, AlertCircle } from "lucide-react";

const meta: Meta<typeof Alert> = {
  title: "UI/Alert",
  component: Alert,
};

export default meta;
type Story = StoryObj<typeof Alert>;

export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-[500px]">
      <Alert variant="default">
        <Info className="size-4" />
        <AlertTitle>Default Alert</AlertTitle>
        <AlertDescription>This is a standard informational callout.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Error Alert</AlertTitle>
        <AlertDescription>Something went wrong. Please check your inputs.</AlertDescription>
      </Alert>
    </div>
  ),
};
