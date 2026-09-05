import type { Meta, StoryObj } from "@storybook/react";
import { ErrorDisplay } from "@/components/ErrorDisplay";

const meta: Meta<typeof ErrorDisplay> = {
  title: "Diagnostics/ErrorDisplay",
  component: ErrorDisplay,
  tags: ["autodocs"],
  argTypes: {
    title: { control: "text" },
    message: { control: "text" },
    stackTrace: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof ErrorDisplay>;

export const Default: Story = {
  args: {
    title: "System.InvalidOperationException",
    message: "Sequence contains no matching element.",
    stackTrace:
      "   at System.Linq.ThrowHelper.ThrowNoMatchException()\n   at System.Linq.Enumerable.First[TSource](IEnumerable`1 source, Func`2 predicate)\n   at IvyFramework.Services.PlanRunner.ExecuteAsync(PlanContext context) in /src/Services/PlanRunner.cs:line 142",
  },
};
