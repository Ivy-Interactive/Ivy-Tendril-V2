import type { Meta, StoryObj } from "@storybook/react";
import { XmlRenderer } from "@/components/XmlRenderer";

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Components" version="1.0">
  <dependencies>
    <dependency id="react" version="^19.0.0" />
    <dependency id="lucide-react" version="^1.0.0" />
  </dependencies>
  <configuration>
    <theme mode="dark" />
    <features enabled="true">
      <feature name="devtools" active="true">Debug tools enabled</feature>
    </features>
  </configuration>
</project>`;

const meta: Meta<typeof XmlRenderer> = {
  title: "Renderers/XmlRenderer",
  component: XmlRenderer,
  tags: ["autodocs"],
  argTypes: {
    initialExpanded: { control: "number" },
  },
};

export default meta;
type Story = StoryObj<typeof XmlRenderer>;

export const Default: Story = {
  args: {
    data: sampleXml,
    initialExpanded: 2,
  },
};
