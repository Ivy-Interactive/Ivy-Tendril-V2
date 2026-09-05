import type { Meta, StoryObj } from "@storybook/react";
import {
  Stepper,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperTitle,
  StepperDescription,
  StepperSeparator,
} from "@/components/ui/stepper";

const meta: Meta = {
  title: "UI/Stepper",
};

export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="w-[600px]">
      <Stepper defaultValue={1}>
        <StepperItem step={1}>
          <StepperTrigger>
            <StepperIndicator />
            <div className="flex flex-col text-left">
              <StepperTitle>Account</StepperTitle>
              <StepperDescription>Setup credentials</StepperDescription>
            </div>
          </StepperTrigger>
          <StepperSeparator />
        </StepperItem>
        <StepperItem step={2}>
          <StepperTrigger>
            <StepperIndicator />
            <div className="flex flex-col text-left">
              <StepperTitle>Personal</StepperTitle>
              <StepperDescription>Add personal info</StepperDescription>
            </div>
          </StepperTrigger>
          <StepperSeparator />
        </StepperItem>
        <StepperItem step={3}>
          <StepperTrigger>
            <StepperIndicator />
            <div className="flex flex-col text-left">
              <StepperTitle>Confirm</StepperTitle>
              <StepperDescription>Review details</StepperDescription>
            </div>
          </StepperTrigger>
        </StepperItem>
      </Stepper>
    </div>
  ),
};
