import type { Meta, StoryObj } from "@storybook/react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

const sampleMarkdown = `
# Markdown Renderer

This is an **interactive demonstration** of the Ivy markdown rendering engine.

> [!NOTE]
> Helpful note callout with custom icon and border styling.

> [!WARNING]
> Important warning callout block.

## Features
- GitHub Flavored Markdown (GFM)
- Mathematical equations via KaTeX: $E = mc^2$
- Code syntax highlighting with Prism
- Tables and task lists:
  - [x] Task completed
  - [ ] Pending task

| Feature | Status | Notes |
| :--- | :---: | :--- |
| KaTeX | Supported | Inline & Block |
| Mermaid | Supported | In code fence |

\`\`\`typescript
interface User {
  id: string;
  name: string;
  roles: string[];
}

const user: User = {
  id: "u-123",
  name: "Alice",
  roles: ["admin"],
};
\`\`\`
`;

const meta: Meta<typeof MarkdownRenderer> = {
  title: "Renderers/MarkdownRenderer",
  component: MarkdownRenderer,
  tags: ["autodocs"],
  argTypes: {
    content: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof MarkdownRenderer>;

export const Default: Story = {
  args: {
    content: sampleMarkdown,
  },
};
