import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TendrilShell } from "./TendrilShell.tsx";
import { ShellSidebarHeader } from "./ShellSidebarHeader.tsx";
import { TendrilLogo } from "../TendrilLogo.tsx";
import { ShellNewPlanButton } from "./ShellNewPlanButton.tsx";
import { ShellAgentButton } from "./ShellAgentButton.tsx";
import { ShellNav } from "./ShellNav.tsx";
import { ShellSidebarSection } from "./ShellSidebarSection.tsx";
import { ShellSettingsButton } from "./ShellSettingsButton.tsx";
import { ShellTabs } from "./ShellTabs.tsx";
import type { ShellNavItemDto, ShellSectionItemDto, ShellTabDto } from "./types.ts";
import "./shell.css";

const meta: Meta<typeof TendrilShell> = {
  title: "Shell/TendrilShell",
  component: TendrilShell,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof TendrilShell>;

const sampleNavItems: ShellNavItemDto[] = [
  { id: "plans", label: "Plans", icon: "Feather", badge: "4", isActive: true },
  { id: "review", label: "Review", icon: "ThumbsUp", badge: "1" },
  { id: "jobs", label: "Jobs", icon: "Activity", badge: "2" },
  { id: "recommendations", label: "Insights", icon: "Lightbulb" },
];

const samplePlans: ShellSectionItemDto[] = [
  {
    id: "00063",
    title: "Port Tendril Shell and Navigation Layout Components",
    tag: "#00063",
    badges: [
      { label: "storybook", kind: "project" },
      { label: "executing", kind: "warning" },
    ],
  },
  {
    id: "00057",
    title: "Port Tendril Widgets and Dashboard Components",
    tag: "#00057",
    badges: [
      { label: "storybook", kind: "project" },
      { label: "pass", kind: "success" },
    ],
  },
  {
    id: "00042",
    title: "Implement Agent Execution Viewer Card",
    tag: "#00042",
    badges: [
      { label: "core", kind: "project" },
      { label: "review", kind: "neutral" },
    ],
  },
];

const sampleTabs: ShellTabDto[] = [
  { id: "session-1", title: "00063-ExecutePlan" },
  { id: "session-2", title: "Interactive Chat" },
];

function InteractiveShellDemo({
  initialCollapsed = false,
  initialActiveSession = null as number | null,
}: {
  initialCollapsed?: boolean;
  initialActiveSession?: number | null;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [activeNav, setActiveNav] = useState("plans");
  const [selectedPlanId, setSelectedPlanId] = useState("00063");
  const [tabs, setTabs] = useState<ShellTabDto[]>(sampleTabs);
  const [activeTabId, setActiveTabId] = useState<string>("session-1");
  const [activeSession, setActiveSession] = useState<number | null>(initialActiveSession);

  const navItems = sampleNavItems.map((item) => ({
    ...item,
    isActive: item.id === activeNav,
  }));

  const handleEvent = (eventName: string, _widgetId: string, args: unknown[]) => {
    if (eventName === "OnCollapsedChanged") {
      setCollapsed(args[0] as boolean);
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <TendrilShell
        id="tendril-shell"
        eventHandler={handleEvent}
        events={["OnCollapsedChanged"]}
        collapsed={collapsed}
        activeSessionIndex={activeSession}
        hasTabs={tabs.length > 0}
        slots={{
          SidebarHeader: (
            <ShellSidebarHeader
              id="sidebar-header"
              title="Tendril"
              logo={<TendrilLogo />}
              version="v1.0.0"
              eventHandler={handleEvent}
            />
          ),
          SidebarBody: (
            <>
              <ShellNewPlanButton
                id="new-plan-btn"
                events={["OnClick"]}
                eventHandler={() => alert("New plan clicked")}
              />
              <ShellAgentButton
                id="agent-btn"
                label="Agent Session"
                icon="ClaudeCode"
                shortcutKey="A"
                events={["OnOpen", "OnNewChat"]}
                eventHandler={(event) => {
                  if (event === "OnOpen" || event === "OnNewChat") {
                    setActiveSession(0);
                  }
                }}
              />
              <ShellNav
                id="shell-nav"
                items={navItems}
                events={["OnSelect"]}
                eventHandler={(_e, _id, [itemId]) => {
                  setActiveNav(itemId as string);
                  setActiveSession(null);
                }}
                showDivider
              />
              <ShellSidebarSection
                id="sidebar-section"
                title="Active Plans"
                searchable
                items={samplePlans}
                selectedId={selectedPlanId}
                events={["OnSelectItem", "OnSearch"]}
                eventHandler={(event, _id, args) => {
                  if (event === "OnSelectItem") setSelectedPlanId(args[0] as string);
                  if (event === "OnSearch") alert("Search clicked");
                }}
              />
            </>
          ),
          SidebarFooter: (
            <ShellSettingsButton
              id="settings-btn"
              events={["OnClick"]}
              eventHandler={() => alert("Settings clicked")}
            />
          ),
          Content: (
            <div style={{ padding: 24 }}>
              <h2>Main Workspace: {activeNav.toUpperCase()}</h2>
              <p>
                Selected Plan ID: <strong>{selectedPlanId}</strong>
              </p>
              <p style={{ color: "#666" }}>
                Use <code>Ctrl+B</code> / <code>Cmd+B</code> or click the sidebar toggle button to
                expand/collapse.
              </p>
            </div>
          ),
          SessionContents: [
            <div
              key="s1"
              style={{ padding: 24, background: "#18181b", color: "#f4f4f5", height: "100%" }}
            >
              <h3>Agent Session 1: 00063-ExecutePlan</h3>
              <p>Streaming agent terminal buffer preserved across tab switches.</p>
              <button
                style={{
                  padding: "6px 12px",
                  background: "#27272a",
                  color: "#fff",
                  border: "1px solid #3f3f46",
                  borderRadius: 6,
                }}
                onClick={() => setActiveSession(null)}
              >
                Return to Workspace Content
              </button>
            </div>,
            <div
              key="s2"
              style={{ padding: 24, background: "#1e293b", color: "#f8fafc", height: "100%" }}
            >
              <h3>Agent Session 2: Interactive Chat</h3>
              <p>Second agent pane.</p>
            </div>,
          ],
          Tabs: (
            <ShellTabs
              id="shell-tabs"
              tabs={tabs}
              selectedId={activeTabId}
              events={["OnSelect", "OnClose", "OnNew"]}
              eventHandler={(event, _id, args) => {
                if (event === "OnSelect") {
                  const tabId = args[0] as string;
                  setActiveTabId(tabId);
                  setActiveSession(tabId === "session-1" ? 0 : 1);
                } else if (event === "OnClose") {
                  const tabId = args[0] as string;
                  setTabs((prev) => prev.filter((t) => t.id !== tabId));
                } else if (event === "OnNew") {
                  const newId = `session-${tabs.length + 1}`;
                  setTabs((prev) => [...prev, { id: newId, title: `Session ${tabs.length + 1}` }]);
                }
              }}
            />
          ),
        }}
      />
    </div>
  );
}

export const FullAppShell: Story = {
  render: () => <InteractiveShellDemo />,
};

export const CollapsedRail: Story = {
  render: () => <InteractiveShellDemo initialCollapsed />,
};

export const WithActiveSessionPane: Story = {
  render: () => <InteractiveShellDemo initialActiveSession={0} />,
};
