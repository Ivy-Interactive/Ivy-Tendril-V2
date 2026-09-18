import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { WebViewer } from "./WebViewer.tsx";

const meta: Meta<typeof WebViewer> = {
  title: "Components/WebViewer",
  component: WebViewer,
  parameters: {
    layout: "fullscreen",
    // Every story frames an external site, so the pixels depend on something outside this repo.
    visual: { disable: true },
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

export const AnnotationDemo: Story = {
  render: () => {
    const [commands, setCommands] = useState<{ id: string }>({ id: "" });
    const [selecting, setSelecting] = useState(false);
    const subscribers = React.useRef(new Map<string, (data: unknown) => void>());

    const subscribeToStream = (streamId: string, onData: (data: unknown) => void) => {
      subscribers.current.set(streamId, onData);
      return () => {
        subscribers.current.delete(streamId);
      };
    };

    const sendCommand = (cmd: string) => {
      const id = `${Date.now()}`;
      setCommands({ id });
      const sub = subscribers.current.get("commands");
      if (sub) {
        sub({ __proxyCmd: cmd });
      }
    };

    const eventHandler = (eventName: string, id: string, args: unknown[]) => {
      console.log("WebViewer event:", eventName, id, args);
    };

    const url = `${window.location.origin}/webviewer-demo/index.html`;

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <div style={{ padding: "1rem", borderBottom: "1px solid #ccc" }}>
          <button
            onClick={() => {
              const newSelecting = !selecting;
              setSelecting(newSelecting);
              sendCommand(newSelecting ? "select-start" : "select-stop");
            }}
            style={{
              padding: "0.5rem 1rem",
              marginRight: "0.5rem",
              cursor: "pointer",
            }}
          >
            {selecting ? "Stop Selecting" : "Start Selecting"}
          </button>
          <button
            onClick={() => setCommands({ id: `${Date.now()}` })}
            style={{ padding: "0.5rem 1rem", marginRight: "0.5rem", cursor: "pointer" }}
          >
            Reload
          </button>
          <button
            onClick={() => sendCommand("back")}
            style={{ padding: "0.5rem 1rem", marginRight: "0.5rem", cursor: "pointer" }}
          >
            Back
          </button>
          <button
            onClick={() => sendCommand("forward")}
            style={{ padding: "0.5rem 1rem", cursor: "pointer" }}
          >
            Forward
          </button>
        </div>
        <div style={{ flex: 1 }}>
          <WebViewer
            id="web-viewer-demo"
            url={url}
            device="Desktop"
            width="full"
            height="full"
            commands={commands}
            subscribeToStream={subscribeToStream}
            events={["OnComment"]}
            eventHandler={eventHandler}
          />
        </div>
      </div>
    );
  },
  // WebViewer renders an external iframe whose third-party DOM is outside this library's control.
  parameters: {
    a11y: {
      disable: true,
    },
  },
};

/**
 * Storybook is served on its own origin, which is not the daemon's, so the proxy paths have to be
 * named explicitly here. In the app this comes from `WebViewerProvider` and no call site says it.
 */
export const ExplicitProxyOrigin: Story = {
  args: {
    id: "web-viewer-explicit-proxy-origin",
    url: "https://example.com",
    device: "Desktop",
    proxyOrigin: "http://127.0.0.1:5010",
    width: "100%",
    height: "800px",
    events: ["OnComment"],
    eventHandler: (eventName: string, id: string, args: unknown[]) => {
      console.log("WebViewer event:", eventName, id, args);
    },
  },
};

export const WithToolbar: Story = {
  args: {
    id: "web-viewer-with-toolbar",
    url: "https://example.com",
    toolbar: true,
    device: "Desktop",
    width: "100%",
    height: "800px",
    actions: [
      {
        id: "comments",
        icon: "MessageSquare",
        label: "Send 2 comments",
        badge: "2",
        primary: true,
      },
      { id: "share", icon: "Share", label: "Share" },
    ],
    events: ["OnEvent"],
    eventHandler: (eventName: string, id: string, args: unknown[]) => {
      console.log("WebViewer event:", eventName, id, args);
    },
  },
};
