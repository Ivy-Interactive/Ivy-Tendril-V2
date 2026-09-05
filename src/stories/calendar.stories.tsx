import type { Meta, StoryObj } from "@storybook/react";
import { Calendar } from "@/components/ui/calendar";
import * as React from "react";

const meta: Meta<typeof Calendar> = {
  title: "UI/Calendar",
  component: Calendar,
};

export default meta;

const CalendarDemo = () => {
  const [date, setDate] = React.useState<Date | undefined>(new Date());
  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      className="rounded-md border w-fit"
    />
  );
};

export const Default: StoryObj<typeof Calendar> = {
  render: () => <CalendarDemo />,
};
