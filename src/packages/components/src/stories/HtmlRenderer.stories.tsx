import type { Meta, StoryObj } from "@storybook/react";
import { HtmlRenderer } from "@/components/HtmlRenderer";

const meta: Meta<typeof HtmlRenderer> = {
  title: "Renderers/HtmlRenderer",
  component: HtmlRenderer,
  tags: ["autodocs"],
  argTypes: {
    content: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof HtmlRenderer>;

export const Default: Story = {
  args: {
    content: `
      <div>
        <h3>Sanitized HTML Content</h3>
        <p>This content is safely parsed and rendered using native React elements.</p>
        <ul>
          <li><strong>Bold text</strong> and <em>italic text</em></li>
          <li><a href="https://github.com" target="_blank">External link</a></li>
          <li><code>code snippet</code></li>
        </ul>
      </div>
    `,
  },
};
