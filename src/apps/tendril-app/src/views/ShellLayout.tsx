import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BrandIcon,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ivy-interactive/components/ui";
import {
  Bug,
  CircleArrowUp,
  CircleHelp,
  Construction,
  ExternalLink,
  GitPullRequest,
  Snowflake,
} from "lucide-react";
import type { ServiceInfo, VersionInfo } from "../types/api";
import { OfflineBanner } from "../components/OfflineBanner";
import { ServiceStatusBanner } from "../components/service";
import { UpdateNotice } from "../components/UpdateNotice";
import { firstStringArg } from "../utils/eventArgs";
import { pageTabTitle, usesSidebarList, type ShellSidebarList } from "../state/sidebarListStore";
import { appDescriptor, isFullBleedApp, type SessionPane } from "../state/navigation";

/**
 * V1 `TendrilAppShell.PageTabId`. Identifies the strip's leading tab, which reveals the page behind
 * the session panes; V1 gives it a `$` prefix so it cannot collide with a session id.
 */
export const PAGE_TAB_ID = "$page";

/**
 * The shell's content container, and the one place an app's outer padding is decided.
 *
 * V1's host pads every app by 16px and owns its vertical scroll
 * (`Ivy-Framework/.../AppHostWidget.tsx`: `<div className="w-full h-full p-4 overflow-y-auto">`);
 * an app opts out by putting `RemoveParentPadding()` on its root layout, which zeroes the *parent's*
 * padding outright - `padding: 0`, never a reduced padding. {@link CONTENT_PADDED_CLASS} is that
 * default and {@link CONTENT_FULL_BLEED_CLASS} is that opt-out, chosen per page from
 * `AppDescriptor.fullBleed` so views carry no outer padding of their own.
 *
 * Both keep the scroll *inside* the frame rather than on the page. `.tsh-frame-pane` is
 * `position: absolute; inset: 0` with `display: flex; flex-direction: column`, so `flex-1` gives this
 * element a definite height either way - which is what lets a view bound its own scroll viewport
 * (`JobsView`'s `fillHeight` table: a `shrink-0` toolbar over a `flex-1 min-h-0` body) and keep its
 * `position: sticky` header working. A page-level scroll container would break both.
 */
export const CONTENT_PADDED_CLASS = "flex-1 overflow-y-auto p-4";

/** The full-bleed content container: no padding, and the app owns every scroll inside it. */
export const CONTENT_FULL_BLEED_CLASS = "flex min-h-0 flex-1 flex-col overflow-hidden";

/**
 * V1 `AppBrand`, which is where the Help menu's three destinations come from
 * (`Constants.DocsUrl` / `DiscordUrl` / `IssuesUrl`). The issue tracker is V2's own repository:
 * the decision is "Report Issue files against the app you are running", not the literal V1 URL.
 */
const DOCS_URL = "https://tendril.ivy.app";
const DISCORD_URL = "https://discord.gg/FHgxkDga3y";
const ISSUES_URL = "https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues/new";

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

/**
 * The nav's badge counts, keyed by the app id V1 keys them by in
 * `TendrilAppShell.BuildMenuItems`'s `badges` dictionary. Dashboard has no key there, so it never
 * carries one; `icebox`, `chat` and `agent` do, but none of the three is a nav row.
 */
export interface ShellNavBadges {
  plans?: number;
  review?: number;
  recommendations?: number;
  jobs?: number;
}

/**
 * V1 `TendrilAppShell.BuildNavItems`: the sidebar nav is the visible `[App(group: ["Apps"])]` set
 * in `Constants` order - Dashboard 10, Plans 20, Review 30, Recommendations 40, Jobs 50 - minus the
 * entries it drops. Chat (75) and Agent (80) are dropped because the dedicated Chat row above the
 * nav reaches them; Inbox (65) is dropped into the footer by `footerAppIds`; Pull Requests (60),
 * Icebox (70) and Configuration are `isVisible: false` and live in the footer's settings menu. So
 * these five, in this order, are the whole nav.
 *
 * A count of zero shows no badge, as V1's `ShouldShowBadge` requires (`count > 0`).
 */
export const buildNavItems = (
  activeNav: string,
  badges: ShellNavBadges = {},
): ShellNavItemDto[] => {
  const badge = (count: number | undefined) =>
    count !== undefined && count > 0 ? String(count) : undefined;

  return [
    { id: "dashboard", label: "Dashboard", icon: "ChartBar" },
    { id: "plans", label: "Plans", icon: "Feather", badge: badge(badges.plans) },
    { id: "review", label: "Review", icon: "ThumbsUp", badge: badge(badges.review) },
    {
      id: "recommendations",
      label: "Recommendations",
      icon: "Lightbulb",
      badge: badge(badges.recommendations),
    },
    { id: "jobs", label: "Jobs", icon: "Activity", badge: badge(badges.jobs) },
  ].map((item) => ({ ...item, isActive: item.id === activeNav }));
};

/**
 * One row of the sidebar footer's settings menu, standing in for V1's `MenuItem`: a label, a glyph,
 * and either an action or a submenu.
 */
export interface ShellMenuItemDto {
  label: string;
  icon: React.ReactNode;
  onSelect?: () => void;
  children?: ShellMenuItemDto[];
}

/**
 * V1 `TendrilAppShell.settingsMenuItems`, row for row and in order, with the Help submenu from
 * `BuildHelpMenuItems`. Two deliberate omissions, both because V2 has nothing to point them at:
 * V1's `#if DEBUG` "Debug > Onboarding" row (V2 has no onboarding route) and the `isBeta` "About"
 * row (V2 has no About view). V1 has no "Keyboard Shortcuts" row and neither does this.
 */
export const buildSettingsMenuItems = ({
  onSelectNav,
  onCheckForUpdates,
}: {
  onSelectNav: (navId: string) => void;
  onCheckForUpdates?: () => void;
}): ShellMenuItemDto[] => {
  const items: ShellMenuItemDto[] = [
    {
      label: "Configuration",
      icon: <Construction aria-hidden="true" />,
      onSelect: () => onSelectNav("settings"),
    },
    {
      label: "Pull Requests",
      icon: <GitPullRequest aria-hidden="true" />,
      onSelect: () => onSelectNav("pull-requests"),
    },
    {
      label: "Icebox",
      icon: <Snowflake aria-hidden="true" />,
      onSelect: () => onSelectNav("icebox"),
    },
  ];

  // V1 always has an update check; V2's host supplies one only where it can perform it.
  if (onCheckForUpdates) {
    items.push({
      label: "Check for Updates",
      icon: <CircleArrowUp aria-hidden="true" />,
      onSelect: onCheckForUpdates,
    });
  }

  items.push({
    label: "Help",
    icon: <CircleHelp aria-hidden="true" />,
    children: [
      {
        label: "Documentation",
        icon: <ExternalLink aria-hidden="true" />,
        onSelect: () => void openUrl(DOCS_URL),
      },
      {
        label: "Discord",
        icon: <BrandIcon name="Discord" />,
        onSelect: () => void openUrl(DISCORD_URL),
      },
      {
        label: "Report Issue",
        icon: <Bug aria-hidden="true" />,
        onSelect: () => void openUrl(ISSUES_URL),
      },
    ],
  });

  return items;
};

/** Renders {@link buildSettingsMenuItems} the way V1's `DropDownMenu.Items(...)` renders `MenuItem`s. */
const renderMenuItems = (items: ShellMenuItemDto[]): React.ReactNode =>
  items.map((item) =>
    item.children ? (
      <DropdownMenuSub key={item.label}>
        <DropdownMenuSubTrigger>
          {item.icon}
          {item.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{renderMenuItems(item.children)}</DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : (
      <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
        {item.icon}
        {item.label}
      </DropdownMenuItem>
    ),
  );

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
  /**
   * V1's `StartNewChat`, bound to the Chat row unconditionally (`TendrilAppShell.cs:1085`:
   * `.OnNewChat(StartNewChat)`), and only *overridden* by a published list's own `OnNew` when that
   * list is a collapsed rail flyout (`.OnNewChat(chatList.OnNew ?? StartNewChat)`).
   */
  onNewChat?: () => void;
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
  onNewChat,
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

  /* `OnNewChat` is unconditional, as in V1: the Chat row's "New Chat" chord has to work from
     Dashboard, Jobs and every other page, not only from the pages that publish a collapsed list.
     Gating it on `railFlyoutList.onNew` left the chord, and the flyout's own button, inert
     everywhere else. */
  const chatEvents = ["OnOpen", "OnNewChat"];
  if (railFlyoutList) {
    chatEvents.push("OnSelectItem");
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
        // The section's own affordance, only ever present when the list supplies it.
        source?.onNew?.();
        return;
      case "OnNewChat":
        // V1's `chatList.OnNew ?? StartNewChat`: the flyout list may override, but the shell's
        // handler is what makes the row work on a page that publishes no list at all.
        (source?.onNew ?? onNewChat)?.();
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

  const navItems = buildNavItems(activeNav, {
    plans: draftCount,
    review: reviewCount,
    recommendations: recommendationsCount,
    jobs: jobCount,
  });

  const settingsMenuItems = buildSettingsMenuItems({ onSelectNav, onCheckForUpdates });

  /* V1 `BuildStripTabs`: the strip is one non-closable `$page` tab, which reveals the page behind
     the session panes, followed by the session tabs. Nothing else is ever in it - a page is not a
     tab. Session tabs pass no icon, so they get the terminal glyph, and they are closable because
     closing one is how the reviewer says they are done watching. */
  const sessions: SessionPane[] = sessionTabs ?? [];

  const pageNavId = pageNav ?? activeNav;
  const pageAppTitle = appDescriptor(pageNavId)?.title ?? pageNavId;
  /* The page behind the session panes is what the content container pads, not the session on top:
     a pane is its own `.tsh-frame-pane` and never passes through this container. */
  const isPageFullBleed = isFullBleedApp(pageNavId);
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
                    {renderMenuItems(settingsMenuItems)}
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
            /* The 16px default, or nothing at all for a full-bleed app. Deciding it here - once,
               from the registry - is what keeps it checkable; a view that wants the frame's edges
               says so in `APP_DESCRIPTORS`, not with classes on its root `<div>`. */
            Content: (
              <main
                data-testid="shell-content"
                data-full-bleed={isPageFullBleed}
                className={isPageFullBleed ? CONTENT_FULL_BLEED_CLASS : CONTENT_PADDED_CLASS}
              >
                {children}
              </main>
            ),
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
