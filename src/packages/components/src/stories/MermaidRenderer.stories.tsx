import type { Meta, StoryObj } from "@storybook/react";
import { MermaidRenderer } from "@/components/MermaidRenderer";

const meta: Meta<typeof MermaidRenderer> = {
  title: "Renderers/MermaidRenderer",
  component: MermaidRenderer,
  tags: ["autodocs"],
  argTypes: {
    content: { control: "text" },
  },
  parameters: {
    // mermaid is imported on first render and lays the diagram out asynchronously, so the visual
    // pass would otherwise screenshot the "Loading diagram…" placeholder.
    visual: { settleDelay: 3000 },
  },
};

export default meta;
type Story = StoryObj<typeof MermaidRenderer>;

export const Flowchart: Story = {
  args: {
    content: `graph TD
    A[Start] --> B{Is it working?}
    B -- Yes --> C[Celebrate]
    B -- No --> D[Debug]
    D --> B`,
  },
};

export const SequenceDiagram: Story = {
  args: {
    content: `sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    User->>Frontend: Click Action
    Frontend->>Backend: Send Request
    Backend-->>Frontend: Return Data
    Frontend-->>User: Update Display`,
  },
};
