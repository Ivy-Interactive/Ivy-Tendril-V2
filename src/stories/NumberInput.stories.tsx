import type { Meta, StoryObj } from "@storybook/react";
import { NumberInput } from "@/components/NumberInput";

const meta: Meta<typeof NumberInput> = {
  title: "Domain/NumberInput",
  component: NumberInput,
  tags: ["autodocs"],
  argTypes: {
    value: { control: "number" },
    step: { control: "number" },
    min: { control: "number" },
    max: { control: "number" },
    isBytesFormat: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Decimal: Story = {
  args: {
    value: 1234.56,
  },
};

export const Bytes: Story = {
  args: {
    value: 10485760,
    isBytesFormat: true,
  },
};
