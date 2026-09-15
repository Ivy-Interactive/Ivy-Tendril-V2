import React from "react";
import {
  TendrilShell,
  ShellSidebarHeader,
  ShellNav,
  ShellTabs,
  ShellNewPlanButton,
  type ShellNavItemDto,
  type ShellTabDto,
} from "@ivy-interactive/components/tendril";
import type { ServiceInfo, VersionInfo } from "../types/api";
import { OfflineBanner } from "../components/OfflineBanner";
import { ServiceStatusBanner } from "../components/service";
import { UpdateNotice } from "../components/UpdateNotice";
import { firstStringArg } from "../utils/eventArgs";

interface ShellLayoutProps {
  activeNav: string;
  activeTabs: string[];
  serviceInfo: ServiceInfo | null;
  connectionStatus: "online" | "reconnecting" | "offline";
  reconnectCountdown: number;
  onSelectNav: (navId: string) => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewPlan: () => void;
  onOpenShortcuts: () => void;
  onReconnect: () => void;
  onRestartService?: () => void;
  onRepairService?: () => void;
  onViewDiagnostics?: () => void;
  versionInfo?: VersionInfo | null;
  dismissedUpdateVersion?: string | null;
  onDismissUpdate?: (version: string) => void;
  onCopyUpdateCommand?: () => void;
  children: React.ReactNode;
}

export const ShellLayout: React.FC<ShellLayoutProps> = ({
  activeNav,
  activeTabs,
  serviceInfo,
  connectionStatus,
  reconnectCountdown,
  onSelectNav,
  onSelectTab,
  onCloseTab,
  onNewPlan,
  onOpenShortcuts,
  onReconnect,
  onRestartService,
  onRepairService,
  onViewDiagnostics,
  versionInfo = null,
  dismissedUpdateVersion = null,
  onDismissUpdate = () => {},
  onCopyUpdateCommand = () => {},
  children,
}) => {
  const navItems: ShellNavItemDto[] = [
    { id: "dashboard", label: "Dashboard", icon: "ChartBar", isActive: activeNav === "dashboard" },
    { id: "chat", label: "Chat", icon: "MessageSquare", isActive: activeNav === "chat" },
    { id: "inbox", label: "Inbox", icon: "Inbox", isActive: activeNav === "inbox" },
    { id: "plans", label: "Plans", icon: "Feather", isActive: activeNav === "plans" },
    { id: "review", label: "Review", icon: "ThumbsUp", isActive: activeNav === "review" },
    {
      id: "pull-requests",
      label: "Pull Requests",
      icon: "GitPullRequest",
      isActive: activeNav === "pull-requests",
    },
    { id: "jobs", label: "Jobs", icon: "Activity", isActive: activeNav === "jobs" },
    { id: "settings", label: "Settings", icon: "Sliders", isActive: activeNav === "settings" },
  ];

  const shellTabs: ShellTabDto[] = activeTabs.map((tabId) => {
    let title = tabId;
    let icon = "File";
    let isClosable = true;

    if (tabId === "dashboard") {
      title = "Dashboard";
      icon = "ChartBar";
      isClosable = false;
    } else if (tabId === "chat") {
      title = "Chat";
      icon = "MessageSquare";
      isClosable = false;
    } else if (tabId === "inbox") {
      title = "Inbox";
      icon = "Inbox";
      isClosable = false;
    } else if (tabId === "plans") {
      title = "Plans Explorer";
      icon = "Feather";
      isClosable = false;
    } else if (tabId === "review") {
      title = "Review";
      icon = "ThumbsUp";
      isClosable = false;
    } else if (tabId === "review-action") {
      // Closable, unlike the other named tabs: it holds one run, and closing it is how the reviewer
      // says they are done watching.
      title = "Review Action";
      icon = "Terminal";
    } else if (tabId === "pull-requests") {
      title = "Pull Requests";
      icon = "GitPullRequest";
      isClosable = false;
    } else if (tabId === "settings") {
      title = "Settings";
      icon = "Sliders";
      isClosable = false;
    } else if (tabId.startsWith("plan-")) {
      title = `Plan ${tabId.replace("plan-", "")}`;
      icon = "FileText";
    } else if (tabId.startsWith("job-")) {
      title = `Job ${tabId.replace("job-", "")}`;
      icon = "Activity";
    }

    return {
      id: tabId,
      title,
      icon,
      isActive: activeNav === tabId,
      isClosable,
    };
  });

  const noop = () => {};

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* Update Available Notice */}
      <UpdateNotice
        info={versionInfo}
        dismissedVersion={dismissedUpdateVersion}
        onDismiss={onDismissUpdate}
        onCopyCommand={onCopyUpdateCommand}
      />

      {/* Top Offline / Reconnection Banner */}
      <OfflineBanner
        status={connectionStatus}
        countdown={reconnectCountdown}
        onReconnect={onReconnect}
      />

      {/* Service Health & Ownership Status Banner */}
      <ServiceStatusBanner
        serviceInfo={serviceInfo}
        onRestart={onRestartService}
        onRepair={onRepairService}
        onViewDiagnostics={onViewDiagnostics}
      />

      <div className="flex-1 overflow-hidden">
        <TendrilShell
          id="tendril-shell"
          eventHandler={noop}
          slots={{
            SidebarHeader: (
              <div className="flex flex-col space-y-2">
                <ShellSidebarHeader
                  id="shell-sidebar-header"
                  title="Tendril"
                  version={serviceInfo?.apiVersion ? `v${serviceInfo.apiVersion}` : "Desktop 0.1.0"}
                  eventHandler={noop}
                />
                <div className="px-2">
                  <ShellNewPlanButton id="new-plan-btn" eventHandler={onNewPlan} />
                </div>
              </div>
            ),
            SidebarBody: (
              <div className="flex flex-col justify-between h-full py-2">
                <ShellNav
                  id="shell-nav"
                  items={navItems}
                  events={["OnSelect"]}
                  eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                    const navId = firstStringArg(args);
                    if (navId) onSelectNav(navId);
                  }}
                />
                <div className="px-4 py-2 border-t border-border/80">
                  <button
                    type="button"
                    onClick={onOpenShortcuts}
                    className="text-xs text-muted-foreground/70 hover:text-muted-foreground flex items-center space-x-1.5"
                  >
                    <span>⌨️</span>
                    <span>Shortcuts (?)</span>
                  </button>
                </div>
              </div>
            ),
            Content: (
              <div className="flex h-full flex-col overflow-hidden">
                {shellTabs.length > 0 && (
                  <div className="border-b border-border bg-card/50">
                    <ShellTabs
                      id="shell-tabs"
                      tabs={shellTabs}
                      events={["OnSelect", "OnClose"]}
                      eventHandler={(evt: string, _id: string, args?: unknown[]) => {
                        const tabId = firstStringArg(args);
                        if (!tabId) return;
                        if (evt === "OnSelect") onSelectTab(tabId);
                        else if (evt === "OnClose") onCloseTab(tabId);
                      }}
                    />
                  </div>
                )}
                <main className="flex-1 overflow-y-auto p-6">{children}</main>
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
};
