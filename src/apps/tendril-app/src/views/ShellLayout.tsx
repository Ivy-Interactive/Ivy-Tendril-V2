import React from "react";
import {
  TendrilShell,
  ShellSidebarHeader,
  ShellNav,
  ShellTabs,
  ShellNewPlanButton,
  ShellAgentButton,
  ShellSettingsButton,
  type ShellNavItemDto,
  type ShellTabDto,
} from "@ivy-interactive/components/tendril";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ivy-interactive/components/ui";
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
  draftCount?: number;
  reviewCount?: number;
  recommendationsCount?: number;
  jobCount?: number;
  chatCount?: number;
  onCheckForUpdates?: () => void;
  children: React.ReactNode;
}

/**
 * The app chrome, mirroring V1's `TendrilAppShell.Build()`.
 *
 * The sidebar body is New Plan, then the Chat row, then the nav (V1's
 * `sidebarBody: [newPlanButton, chatButton, nav, section]`). Chat and Inbox are
 * deliberately absent from the nav: V1's `BuildNavItems` drops the agent and chat
 * entries because the dedicated Chat row above the nav reaches them, and drops
 * `footerAppIds` because the Inbox gets its own icon-only footer button
 * (`ShowInboxInFooter`). Settings, Pull Requests, and Icebox are `isVisible: false` apps in
 * V1, reached from the footer's settings menu (`settingsMenuItems`), not the nav.
 */
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
  draftCount,
  reviewCount,
  recommendationsCount,
  jobCount,
  chatCount,
  onCheckForUpdates,
  children,
}) => {
  /* V1's visible "Apps" group in `Constants` order (Dashboard 10, Plans 20, Review 30,
     Recommendations 40, Jobs 50), minus the entries `BuildNavItems` excludes. */
  const navItems: ShellNavItemDto[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: "ChartBar",
      isActive: activeNav === "dashboard",
    },
    {
      id: "plans",
      label: "Plans",
      icon: "Feather",
      badge: draftCount && draftCount > 0 ? String(draftCount) : undefined,
      isActive: activeNav === "plans",
    },
    {
      id: "review",
      label: "Review",
      icon: "ThumbsUp",
      badge: reviewCount && reviewCount > 0 ? String(reviewCount) : undefined,
      isActive: activeNav === "review",
    },
    {
      id: "recommendations",
      label: "Recommendations",
      icon: "Lightbulb",
      badge: recommendationsCount && recommendationsCount > 0 ? String(recommendationsCount) : undefined,
      isActive: activeNav === "recommendations",
    },
    {
      id: "jobs",
      label: "Jobs",
      icon: "Activity",
      badge: jobCount && jobCount > 0 ? String(jobCount) : undefined,
      isActive: activeNav === "jobs",
    },
  ];

  /* V1 splits the strip into non-closable page tabs, which carry the icon of the app
     they reveal, and closable session tabs, which carry the terminal glyph and an X
     (`BuildStripTabs`). Only `closable` and `icon` reach ShellTabs; the selection comes
     from `selectedId`, as in `SelectedStripTabId`. */
  const shellTabs: ShellTabDto[] = activeTabs.map((tabId) => {
    let title = tabId;
    let icon: string | undefined = "File";
    let closable = true;

    if (tabId === "dashboard") {
      title = "Dashboard";
      icon = "ChartBar";
      closable = false;
    } else if (tabId === "chat") {
      title = "Chat";
      icon = "MessageSquare";
      closable = false;
    } else if (tabId === "inbox") {
      title = "Inbox";
      icon = "Inbox";
      closable = false;
    } else if (tabId === "plans") {
      title = "Plans Explorer";
      icon = "Feather";
      closable = false;
    } else if (tabId === "review") {
      title = "Review";
      icon = "ThumbsUp";
      closable = false;
    } else if (tabId === "recommendations") {
      title = "Recommendations";
      icon = "Lightbulb";
      closable = false;
    } else if (tabId === "jobs") {
      title = "Jobs";
      icon = "Activity";
      closable = false;
    } else if (tabId === "review-action") {
      // Closable, unlike the other named tabs: it holds one run, and closing it is how the
      // reviewer says they are done watching. It passes no icon, so it gets the terminal
      // glyph every session tab gets.
      title = "Review Action";
      icon = undefined;
    } else if (tabId === "pull-requests") {
      title = "Pull Requests";
      icon = "GitPullRequest";
      closable = false;
    } else if (tabId === "icebox") {
      title = "Icebox";
      icon = "Snowflake";
      closable = false;
    } else if (tabId === "settings") {
      title = "Settings";
      icon = "Settings";
      closable = false;
    } else if (tabId.startsWith("plan-")) {
      title = `Plan ${tabId.replace("plan-", "")}`;
      icon = "FileText";
    } else if (tabId.startsWith("job-")) {
      title = `Job ${tabId.replace("job-", "")}`;
      icon = "Activity";
    }

    return { id: tabId, title, icon, closable };
  });

  /* V1's `.HasTabs(stripTabs.Count > 0)` counts session tabs only: the page tabs never
     keep the strip alive on their own, and ShellTabs applies the same rule to its own
     markup. Keep the two in step. */
  const hasSessionTabs = shellTabs.some((tab) => tab.closable !== false);

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
          hasTabs={hasSessionTabs}
          slots={{
            // The header is the brand row alone. V1 formats the version as "v <x.y.z>".
            SidebarHeader: (
              <ShellSidebarHeader
                id="shell-sidebar-header"
                title="Tendril"
                version={serviceInfo?.apiVersion ? `v ${serviceInfo.apiVersion}` : undefined}
                eventHandler={noop}
              />
            ),
            SidebarBody: (
              <>
                <ShellNewPlanButton id="new-plan-btn" eventHandler={onNewPlan} />
                {/* V1's chatButton: label "Chat", the MessageCircle glyph, active while the
                    chat page is showing, with session count badge. */}
                <ShellAgentButton
                  id="shell-chat-btn"
                  label="Chat"
                  icon="MessageCircle"
                  badge={chatCount && chatCount > 0 ? String(chatCount) : undefined}
                  isActive={activeNav === "chat"}
                  events={["OnOpen"]}
                  eventHandler={() => onSelectNav("chat")}
                />
                <ShellNav
                  id="shell-nav"
                  items={navItems}
                  showDivider
                  events={["OnSelect"]}
                  eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                    const navId = firstStringArg(args);
                    if (navId) onSelectNav(navId);
                  }}
                />
              </>
            ),
            /* V1's footer is `[settingsMenu, inboxButton]`: the settings cog is a
               DropDownMenu trigger and the Inbox its own button, both icon-only
               (`ShowLabel(!inboxInFooter)` is false whenever the Inbox is in the footer). */
            SidebarFooter: (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <ShellSettingsButton
                      id="shell-settings-btn"
                      label="Settings"
                      icon="Settings"
                      showLabel={false}
                      isActive={activeNav === "settings"}
                      eventHandler={noop}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start">
                    <DropdownMenuItem onSelect={() => onSelectNav("settings")}>
                      Configuration
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onSelectNav("pull-requests")}>
                      Pull Requests
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onSelectNav("icebox")}>
                      Icebox
                    </DropdownMenuItem>
                    {onCheckForUpdates && (
                      <DropdownMenuItem onSelect={onCheckForUpdates}>
                        Check for Updates
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onOpenShortcuts}>
                      Keyboard Shortcuts
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ShellSettingsButton
                  id="shell-inbox-btn"
                  label="Inbox"
                  icon="Inbox"
                  showLabel={false}
                  isActive={activeNav === "inbox"}
                  events={["OnClick"]}
                  eventHandler={() => onSelectNav("inbox")}
                />
              </>
            ),
            Content: <main className="flex-1 overflow-y-auto p-6">{children}</main>,
            /* The strip belongs to the shell frame's bottom edge, not to the content: V1
               hands it to the `tabs` slot and gates the row on `hasTabs`. */
            Tabs: (
              <ShellTabs
                id="shell-tabs"
                tabs={shellTabs}
                selectedId={activeNav}
                events={["OnSelect", "OnClose"]}
                eventHandler={(evt: string, _id: string, args?: unknown[]) => {
                  const tabId = firstStringArg(args);
                  if (!tabId) return;
                  if (evt === "OnSelect") onSelectTab(tabId);
                  else if (evt === "OnClose") onCloseTab(tabId);
                }}
              />
            ),
          }}
        />
      </div>
    </div>
  );
};
