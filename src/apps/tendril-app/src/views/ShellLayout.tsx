import React from "react";
import {
  TendrilShell,
  ShellSidebarHeader,
  ShellNav,
  ShellSidebarSection,
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
import { pageTabTitle, usesSidebarList, type ShellSidebarList } from "../state/sidebarListStore";
import { appDescriptor, type SessionPane } from "../state/navigation";

/**
 * V1 `TendrilAppShell.PageTabId`. Identifies the strip's leading tab, which reveals the page behind
 * the session panes; V1 gives it a `$` prefix so it cannot collide with a session id.
 */
export const PAGE_TAB_ID = "$page";

/**
 * The `[App]` icon of the app a nav id names, which is the glyph V1's `$page` tab carries
 * (`BrandedAppDisplay`). Titles come from the router's descriptor table instead of being repeated
 * here, so the strip and the browser title cannot drift from what routing thinks an app is called.
 * A session tab passes no icon at all and gets the terminal glyph.
 */
const pageIcon = (navId: string): string | undefined => {
  switch (navId) {
    case "dashboard":
      return "ChartBar";
    case "chat":
      return "MessageSquare";
    case "inbox":
      return "Inbox";
    case "plans":
      return "Feather";
    case "review":
      return "ThumbsUp";
    case "recommendations":
      return "Lightbulb";
    case "jobs":
      return "Activity";
    case "pull-requests":
      return "GitPullRequest";
    case "icebox":
      return "Snowflake";
    case "settings":
      return "Settings";
    default:
      if (navId.startsWith("plan-")) return "FileText";
      if (navId.startsWith("job-")) return "Activity";
      return "File";
  }
};

interface ShellLayoutProps {
  activeNav: string;
  /**
   * The strip's session panes, which are the `allowDuplicateTabs` apps (review-action runs, and agent
   * terminals once V2 has them) and nothing else. Navigating a page never adds one: V1's strip is the
   * non-closable `$page` tab plus the sessions (`TendrilAppShell.BuildStripTabs`), so the page tab
   * *is* the page.
   */
  sessionTabs?: SessionPane[];
  /**
   * Ignored. It used to be the strip's contents, which is how ordinary pages ended up accumulating
   * there. A page is never a tab, and a session pane only ever comes from
   * {@link ShellLayoutProps.sessionTabs}, so there is nothing a list of nav ids can contribute.
   * Accepted only so callers that still pass it keep compiling; drop it at the call site.
   */
  activeTabs?: string[];
  /** The session pane on top, or null while the page is showing (V1's `selectedIndex`). */
  activeSessionId?: string | null;
  /**
   * One node per entry in {@link ShellLayoutProps.sessionTabs}, in the same order. Every pane stays
   * mounted and only the active one is visible, which is what keeps a review action's terminal
   * running while the reviewer goes back to the plan (V1's `ShowPage` comment).
   */
  sessionContents?: React.ReactNode[];
  /**
   * The page the `$page` tab reveals (V1's `currentApp`), which is `activeNav` unless a session pane
   * is showing over it.
   */
  pageNav?: string;
  serviceInfo: ServiceInfo | null;
  connectionStatus: "online" | "reconnecting" | "offline";
  reconnectCountdown: number;
  onSelectNav: (navId: string) => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** V1 `ShowPage`: the `$page` tab was picked, so reveal the page and leave the panes mounted. */
  onShowPage?: () => void;
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
  /**
   * The contextual list the active app published into the sidebar (V1's `ShellSidebarListSignal`).
   * Absent, or belonging to an app the user has navigated away from, leaves the section holding the
   * full-width Search button V1 shows for every app without a list.
   */
  sidebarList?: ShellSidebarList | null;
  /**
   * A sidebar row click. V1 routes it as `OpenApp(new NavigateArgs(list.AppId,
   * list.BuildSelectArgs(itemId)))`, so the handler gets exactly what V1's shell has: the list's
   * app, the row's id, and the args the list built for it.
   */
  onSelectSidebarItem?: (appId: string, itemId: string, args: unknown) => void;
  /** V1's `showPlanSearchDialog`: what the section's search does when a list supplies no `onSearch`. */
  onPlanSearch?: () => void;
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
  sessionTabs,
  activeSessionId = null,
  sessionContents,
  pageNav,
  serviceInfo,
  connectionStatus,
  reconnectCountdown,
  onSelectNav,
  onSelectTab,
  onCloseTab,
  onShowPage,
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
  sidebarList = null,
  onSelectSidebarItem,
  onPlanSearch,
  children,
}) => {
  /* V1 `TendrilAppShell.Build()` line-for-line: a published list is rendered while
     `UsesSidebarList` holds, so moving between two sidebar-section apps (Review to Plans) does not
     blank the sidebar; anything else falls back to the section's own Search button. */
  const list = sidebarList && usesSidebarList(sidebarList.appId, activeNav) ? sidebarList : null;

  /* V1 folds a `CollapsedMenu` list into the Chat row's rail flyout (`chatButton.List(...)`)
     instead of leaving it on the rail as narrow ID chips, and `ShellSidebarSection` drops its own
     rail list for the same flag. Only the rail shows it: `ShellAgentButton` reads `useShell()`. */
  const railFlyoutList = list?.collapsedMenu ? list : null;

  const sectionEvents = ["OnSearch"];
  if (list) {
    sectionEvents.push("OnSelectItem");
    if (list.onNew) sectionEvents.push("OnNew");
    if (list.onRename) sectionEvents.push("OnRenameItem");
    if (list.onDelete) sectionEvents.push("OnDeleteItem");
    if (list.onTogglePin) sectionEvents.push("OnTogglePinItem");
  }

  const chatEvents = ["OnOpen"];
  if (railFlyoutList) {
    chatEvents.push("OnSelectItem");
    if (railFlyoutList.onNew) chatEvents.push("OnNewChat");
    if (railFlyoutList.onRename) chatEvents.push("OnRenameItem");
    if (railFlyoutList.onDelete) chatEvents.push("OnDeleteItem");
    if (railFlyoutList.onTogglePin) chatEvents.push("OnTogglePinItem");
  }

  /** Row actions and the two affordances, shared by the expanded section and the rail flyout. */
  const handleListEvent = (source: ShellSidebarList | null, evt: string, args?: unknown[]) => {
    switch (evt) {
      case "OnSearch":
        // V1: `.OnSearch(list.OnSearch ?? showPlanSearchDialog)` - absent means the plan search.
        (source?.onSearch ?? onPlanSearch)?.();
        return;
      case "OnNew":
      case "OnNewChat":
        source?.onNew?.();
        return;
      case "OnSelectItem": {
        const itemId = firstStringArg(args);
        if (itemId && source) {
          onSelectSidebarItem?.(source.appId, itemId, source.buildSelectArgs(itemId));
        }
        return;
      }
      case "OnRenameItem": {
        // The section sends a rename as one `[id, title]` tuple argument, not two arguments.
        const pair = args?.[0];
        if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") {
          source?.onRename?.(pair[0], pair[1]);
        }
        return;
      }
      case "OnDeleteItem": {
        const itemId = firstStringArg(args);
        if (itemId) source?.onDelete?.(itemId);
        return;
      }
      case "OnTogglePinItem": {
        const itemId = firstStringArg(args);
        if (itemId) source?.onTogglePin?.(itemId);
        return;
      }
    }
  };

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
      badge:
        recommendationsCount && recommendationsCount > 0 ? String(recommendationsCount) : undefined,
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

  /* V1 `BuildStripTabs`: the strip is one non-closable `$page` tab, which reveals the page behind
     the session panes, followed by the session tabs. Nothing else is ever in it - a page is not a
     tab. Session tabs pass no icon, so they get the terminal glyph, and they are closable because
     closing one is how the reviewer says they are done watching. */
  const sessions: SessionPane[] = sessionTabs ?? [];

  const pageNavId = pageNav ?? activeNav;
  const pageAppTitle = appDescriptor(pageNavId)?.title ?? pageNavId;
  /* V1 `PageTabDisplay` / `PageTabTitle`: the page tab is named after the selected sidebar row, so
     the strip reads "#74 Draft" rather than the generic "Plans", falling back to the app's own
     title. V1 restricts that to the list's own app (`published.AppId == pageAppId`). */
  const pageTitle =
    list && pageNavId === list.appId ? pageTabTitle(pageAppTitle, list) : pageAppTitle;

  const shellTabs: ShellTabDto[] = [
    { id: PAGE_TAB_ID, title: pageTitle, icon: pageIcon(pageNavId), closable: false },
    ...sessions.map((session) => ({ id: session.id, title: session.title })),
  ];

  /* V1's `.HasTabs(stripTabs.Count > 0)` counts session tabs only: the page tab never keeps the
     strip alive on its own, and ShellTabs applies the same rule to its own markup. Keep the two in
     step. */
  const hasSessionTabs = sessions.length > 0;

  /* V1 `SelectedStripTabId`: the active session's id, or the page tab when no session is showing. */
  const activeSession =
    activeSessionId ?? (sessions.some((s) => s.id === activeNav) ? activeNav : null);
  const selectedStripTabId = activeSession ?? PAGE_TAB_ID;
  const activeSessionIndex = activeSession
    ? sessions.findIndex((session) => session.id === activeSession)
    : null;

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
          activeSessionIndex={activeSessionIndex}
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
                  listTitle={railFlyoutList?.title}
                  items={railFlyoutList?.items}
                  selectedId={railFlyoutList?.selectedId ?? undefined}
                  events={chatEvents}
                  eventHandler={(evt: string, _id: string, args?: unknown[]) => {
                    if (evt === "OnOpen") {
                      onSelectNav("chat");
                      return;
                    }
                    handleListEvent(railFlyoutList, evt, args);
                  }}
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
                {/* V1's `section`, last in `sidebarBody`. With a published list it is that list's
                    header, rows and row actions; without one it is the full-width Search button,
                    which is how V1 keeps plan search reachable from every app's sidebar. */}
                <ShellSidebarSection
                  id="shell-sidebar-section"
                  title={list?.title}
                  items={list?.items ?? []}
                  selectedId={list?.selectedId ?? undefined}
                  searchable={list ? list.searchable !== false : true}
                  searchLabel={list?.searchLabel}
                  newLabel={list?.newLabel}
                  collapsedMenu={list?.collapsedMenu ?? false}
                  events={sectionEvents}
                  eventHandler={(evt: string, _id: string, args?: unknown[]) =>
                    handleListEvent(list, evt, args)
                  }
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
            /* V1's `sessionContents`: every session pane stays mounted and only the active one is
               visible, so a review action's terminal keeps its buffer - and keeps running - while
               the reviewer goes back to the plan behind it. */
            SessionContents: sessionContents?.map((pane, index) => (
              <React.Fragment key={sessions[index]?.id ?? index}>{pane}</React.Fragment>
            )),
            /* The strip belongs to the shell frame's bottom edge, not to the content: V1
               hands it to the `tabs` slot and gates the row on `hasTabs`. */
            Tabs: (
              <ShellTabs
                id="shell-tabs"
                tabs={shellTabs}
                selectedId={selectedStripTabId}
                events={["OnSelect", "OnClose"]}
                eventHandler={(evt: string, _id: string, args?: unknown[]) => {
                  const tabId = firstStringArg(args);
                  if (!tabId) return;
                  if (evt === "OnClose") {
                    onCloseTab(tabId);
                    return;
                  }
                  if (evt !== "OnSelect") return;
                  // V1: `if (tabId == PageTabId) ShowPage(); else SelectSession(...)`.
                  if (tabId === PAGE_TAB_ID) onShowPage?.();
                  else onSelectTab(tabId);
                }}
              />
            ),
          }}
        />
      </div>
    </div>
  );
};
