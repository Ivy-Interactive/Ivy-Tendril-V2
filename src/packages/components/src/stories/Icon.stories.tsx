import type { Meta, StoryObj } from "@storybook/react";
import { Icon } from "@/components/Icon";

const meta: Meta<typeof Icon> = {
  title: "Domain/Icon",
  component: Icon,
  tags: ["autodocs"],
  argTypes: {
    name: { control: "text" },
    size: { control: "text" },
    className: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof Icon>;

export const Default: Story = {
  args: {
    name: "Heart",
    size: "24px",
  },
};

export const CustomIcons: Story = {
  render: () => (
    <div className="flex items-center gap-6 text-foreground">
      <div className="flex flex-col items-center gap-2">
        <Icon name="Antigravity" size="32px" />
        <span className="text-xs">Antigravity</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Icon name="OpenCode" size="32px" />
        <span className="text-xs">OpenCode</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Icon name="ClaudeCode" size="32px" />
        <span className="text-xs">ClaudeCode</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Icon name="IvyCorner" size="32px" />
        <span className="text-xs">IvyCorner</span>
      </div>
    </div>
  ),
};

export const BrandIcons: Story = {
  render: () => (
    <div className="flex items-center gap-6 text-foreground">
      <div className="flex flex-col items-center gap-2">
        <Icon name="FaGithub" size="28px" />
        <span className="text-xs">FaGithub</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Icon name="SiTypescript" size="28px" />
        <span className="text-xs">SiTypescript</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Icon name="LuTerminal" size="28px" />
        <span className="text-xs">LuTerminal</span>
      </div>
    </div>
  ),
};
