import type { Meta, StoryObj } from "@storybook/react";
import { WebViewer } from "./WebViewer.tsx";

const meta: Meta<typeof WebViewer> = {
  title: "Components/WebViewer",
  component: WebViewer,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof WebViewer>;

export const Desktop: Story = {
  args: {
    id: "web-viewer-desktop",
    url: "https://example.com",
    device: "Desktop",
    width: "100%",
    height: "800px",
    events: ["OnComment"],
    eventHandler: (eventName: string, id: string, args: unknown[]) => {
      console.log("WebViewer event:", eventName, id, args);
    },
  },
};

export const Tablet: Story = {
  args: {
    id: "web-viewer-tablet",
    url: "https://example.com",
    device: "Tablet",
    width: "100%",
    height: "800px",
    events: ["OnComment"],
    eventHandler: (eventName: string, id: string, args: unknown[]) => {
      console.log("WebViewer event:", eventName, id, args);
    },
  },
};

export const Mobile: Story = {
  args: {
    id: "web-viewer-mobile",
    url: "https://example.com",
    device: "Mobile",
    width: "100%",
    height: "800px",
    events: ["OnComment"],
    eventHandler: (eventName: string, id: string, args: unknown[]) => {
      console.log("WebViewer event:", eventName, id, args);
    },
  },
};
