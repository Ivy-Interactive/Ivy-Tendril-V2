import type { Meta, StoryObj } from "@storybook/react";
import { TendrilProcessViewer } from "./TendrilProcessViewer.tsx";

const meta: Meta<typeof TendrilProcessViewer> = {
  title: "Components/TendrilProcessViewer",
  component: TendrilProcessViewer,
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof TendrilProcessViewer>;

export const InitialDraftState: Story = {
  args: {
    id: "process-viewer-initial",
    draftCount: 0,
    reviewCount: 0,
    creatingPlansCount: 0,
    updatingPlansCount: 0,
    executingPlansCount: 0,
    retryingPlansCount: 0,
    creatingPrCount: 0,
    events: ["OnCreate", "OnDrafts", "OnReview", "OnJobs"],
    eventHandler: (event: string, id: string) => console.log(`[${event}] fired on ${id}`),
  },
};

export const ActiveExecution: Story = {
  args: {
    id: "process-viewer-executing",
    draftCount: 4,
    reviewCount: 1,
    creatingPlansCount: 1,
    updatingPlansCount: 2,
    executingPlansCount: 3,
    retryingPlansCount: 0,
    creatingPrCount: 0,
    events: ["OnCreate", "OnDrafts", "OnReview", "OnJobs"],
    eventHandler: (event: string, id: string) => console.log(`[${event}] fired on ${id}`),
  },
};

export const RetryingFailedVerification: Story = {
  args: {
    id: "process-viewer-retrying",
    draftCount: 2,
    reviewCount: 3,
    creatingPlansCount: 0,
    updatingPlansCount: 0,
    executingPlansCount: 1,
    retryingPlansCount: 2,
    creatingPrCount: 0,
    events: ["OnCreate", "OnDrafts", "OnReview", "OnJobs"],
    eventHandler: (event: string, id: string) => console.log(`[${event}] fired on ${id}`),
  },
};

export const CompletedLifecycleWithPr: Story = {
  args: {
    id: "process-viewer-completed",
    draftCount: 1,
    reviewCount: 2,
    creatingPlansCount: 0,
    updatingPlansCount: 0,
    executingPlansCount: 0,
    retryingPlansCount: 0,
    creatingPrCount: 2,
    events: ["OnCreate", "OnDrafts", "OnReview", "OnJobs"],
    eventHandler: (event: string, id: string) => console.log(`[${event}] fired on ${id}`),
  },
};
