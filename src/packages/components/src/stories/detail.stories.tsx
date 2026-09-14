import type { Meta, StoryObj } from "@storybook/react";
import { Details, DetailItem } from "@/components/ui/detail";

const meta: Meta = {
  title: "UI/Details",
};

export default meta;

export const Default: StoryObj = {
  render: () => (
    <Details className="w-[400px]">
      <DetailItem label="Status">Active</DetailItem>
      <DetailItem label="Version">2.4.0</DetailItem>
      <DetailItem label="Environment">Production</DetailItem>
    </Details>
  ),
};
