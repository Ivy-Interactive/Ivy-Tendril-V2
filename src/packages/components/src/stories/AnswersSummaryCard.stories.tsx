import type { Meta, StoryObj } from "@storybook/react";
import { AnswersSummaryCard } from "@/components/TendrilQuestions";

const meta: Meta<typeof AnswersSummaryCard> = {
  title: "Tendril/AnswersSummaryCard",
  component: AnswersSummaryCard,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof AnswersSummaryCard>;

export const Default: Story = {
  render: () => (
    <div className="flex max-w-md flex-col p-4">
      <AnswersSummaryCard
        answers={[
          {
            label: "How should we proceed?",
            value: "Open a PR",
            skipped: false,
            noPreference: false,
          },
          {
            label: "Which checks should run?",
            value: "Lint, Build, Test",
            skipped: false,
            noPreference: false,
          },
          {
            label: "Which environment?",
            value: "",
            skipped: false,
            noPreference: true,
          },
          {
            label: "Anything else?",
            value: "",
            skipped: true,
            noPreference: false,
          },
        ]}
      />
    </div>
  ),
};
