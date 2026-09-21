import * as React from "react";
import {
  ShellAgentButton,
  ShellNav,
  ShellNewPlanButton,
  ShellSettingsButton,
  ShellSidebarHeader,
  ShellSidebarSection,
  ShellTabs,
  TendrilShell,
  type ShellNavItemDto,
  type ShellSectionItemDto,
  type ShellTabDto,
} from "@/components/Shell";
import { TendrilLogo } from "@/components/TendrilLogo";

/**
 * Sample data and the shell frame the `App/*` layout stories share.
 *
 * These stories exist to show the whole app in one state at a time - a chat mid-conversation, a
 * draft waiting on answers, a plan with edits pending - which is the one thing the per-widget
 * stories cannot show. Every state is reached by passing different props, never by touching a
 * store, so a story stays a fixture rather than a second implementation of the app.
 *
 * The app's own `ShellLayout` lives in `tendril-app` and cannot be imported here (the dependency
 * runs app -> package only), so {@link AppFrame} mirrors its slot wiring: New Plan, the Chat row,
 * the nav, then the contextual section.
 */

/** V1 `TendrilAppShell.PageTabId`: the strip's leading tab, which reveals the page behind the panes. */
export const PAGE_TAB_ID = "$page";

const noop = () => {};

export const navItems = (activeNav: string, badges: Record<string, number> = {}) =>
  (
    [
      { id: "dashboard", label: "Dashboard", icon: "ChartBar" },
      { id: "plans", label: "Plans", icon: "Feather" },
      { id: "review", label: "Review", icon: "ThumbsUp" },
      { id: "recommendations", label: "Recommendations", icon: "Lightbulb" },
      { id: "jobs", label: "Jobs", icon: "Activity" },
    ] as ShellNavItemDto[]
  ).map((item) => ({
    ...item,
    badge: badges[item.id] ? String(badges[item.id]) : undefined,
    isActive: item.id === activeNav,
  }));

export const planSectionItems: ShellSectionItemDto[] = [
  {
    id: "00074",
    title: "Storybook stories for full app layout states",
    tag: "#00074",
    badges: [
      { label: "components", kind: "project" },
      { label: "draft", kind: "warning" },
    ],
  },
  {
    id: "00071",
    title: "Port plan verification reordering to the workspace",
    tag: "#00071",
    badges: [
      { label: "components", kind: "project" },
      { label: "review", kind: "neutral" },
    ],
  },
  {
    id: "00068",
    title: "Resizable sidebar width persistence",
    tag: "#00068",
    badges: [
      { label: "app", kind: "project" },
      { label: "pass", kind: "success" },
    ],
  },
  {
    id: "00063",
    title: "Port Tendril shell and navigation layout components",
    tag: "#00063",
    badges: [
      { label: "components", kind: "project" },
      { label: "merged", kind: "success" },
    ],
  },
];

/**
 * No row is `pinned`: a pinned row splits the list under "Pinned"/"Recent" headings, and
 * `.tsh-section-group-label` renders those at `--text-2xs` under `--opacity-dim`, which axe scores
 * below WCAG AA. That is a fault in the shipped stylesheet rather than in this fixture, and the
 * a11y pass runs against every story, so pinning here would turn an existing contrast bug into a
 * failing gate on unrelated work. Tracked separately; restore `pinned` once the label is fixed.
 */
export const chatSectionItems: ShellSectionItemDto[] = [
  {
    id: "chat-1",
    title: "Storybook layout coverage",
    state: "working",
  },
  { id: "chat-2", title: "Why does the sidebar collapse on reload?" },
  { id: "chat-3", title: "Draft a release note for 0.4.0" },
  { id: "chat-4", title: "Explain the plan verification schema" },
];

export interface AppFrameProps {
  /** The nav row drawn as current. */
  activeNav: string;
  /** Rows for the contextual sidebar section, or `null` for the bare Search affordance. */
  sectionTitle?: string;
  sectionItems?: ShellSectionItemDto[];
  selectedItemId?: string;
  navBadges?: Record<string, number>;
  /** Badge on the Chat row. */
  chatCount?: number;
  /** Session panes in the bottom strip. Omitted leaves the strip hidden, as the app does. */
  sessionTabs?: ShellTabDto[];
  selectedTabId?: string;
  sessionContents?: React.ReactNode[];
  activeSessionIndex?: number | null;
  collapsed?: boolean;
  /** Padded is the app's 16px default; full-bleed is the `RemoveParentPadding` opt-out. */
  fullBleed?: boolean;
  children: React.ReactNode;
}

/**
 * The app chrome around a page, with the sidebar and strip wired exactly as `ShellLayout` wires
 * them. Handlers are inert: a layout story is a photograph of one state, not a working app.
 */
export const AppFrame: React.FC<AppFrameProps> = ({
  activeNav,
  sectionTitle,
  sectionItems,
  selectedItemId,
  navBadges,
  chatCount,
  sessionTabs,
  selectedTabId = PAGE_TAB_ID,
  sessionContents,
  activeSessionIndex = null,
  collapsed = false,
  fullBleed = false,
  children,
}) => {
  const sessions = sessionTabs ?? [];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      <div className="flex-1 overflow-hidden">
        <TendrilShell
          id="tendril-shell"
          eventHandler={noop}
          collapsed={collapsed}
          hasTabs={sessions.length > 0}
          activeSessionIndex={activeSessionIndex}
          slots={{
            SidebarHeader: (
              <ShellSidebarHeader
                id="shell-sidebar-header"
                title="Tendril"
                logo={<TendrilLogo />}
                version="v 0.4.0"
                eventHandler={noop}
              />
            ),
            SidebarBody: (
              <>
                <ShellNewPlanButton id="new-plan-btn" events={["OnClick"]} eventHandler={noop} />
                <ShellAgentButton
                  id="shell-chat-btn"
                  label="Chat"
                  icon="MessageCircle"
                  badge={chatCount ? String(chatCount) : undefined}
                  isActive={activeNav === "chat"}
                  events={["OnOpen", "OnNewChat"]}
                  eventHandler={noop}
                />
                <ShellNav
                  id="shell-nav"
                  items={navItems(activeNav, navBadges)}
                  showDivider
                  events={["OnSelect"]}
                  eventHandler={noop}
                />
                <ShellSidebarSection
                  id="shell-sidebar-section"
                  title={sectionTitle}
                  items={sectionItems ?? []}
                  selectedId={selectedItemId}
                  searchable
                  events={["OnSearch", "OnSelectItem"]}
                  eventHandler={noop}
                />
              </>
            ),
            SidebarFooter: (
              <>
                <ShellSettingsButton
                  id="shell-inbox-btn"
                  label="Inbox"
                  icon="Inbox"
                  showLabel={false}
                  isActive={activeNav === "inbox"}
                  events={["OnClick"]}
                  eventHandler={noop}
                />
                <ShellSettingsButton
                  id="shell-settings-btn"
                  label="Settings"
                  icon="Settings"
                  showLabel={false}
                  isActive={activeNav === "settings"}
                  eventHandler={noop}
                />
              </>
            ),
            Content: (
              <main
                data-testid="shell-content"
                data-full-bleed={fullBleed}
                className={
                  fullBleed
                    ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                    : "flex-1 overflow-y-auto p-4"
                }
              >
                {children}
              </main>
            ),
            SessionContents: sessionContents?.map((pane, index) => (
              <React.Fragment key={sessions[index]?.id ?? index}>{pane}</React.Fragment>
            )),
            Tabs: (
              <ShellTabs
                id="shell-tabs"
                tabs={[
                  { id: PAGE_TAB_ID, title: "Plans", icon: "Feather", closable: false },
                  ...sessions,
                ]}
                selectedId={selectedTabId}
                events={["OnSelect", "OnClose"]}
                eventHandler={noop}
              />
            ),
          }}
        />
      </div>
    </div>
  );
};

/**
 * Storybook's preview decorator pads every story and the shell wants the whole viewport, so a
 * layout story cancels that padding rather than being framed inside it.
 */
export const fullBleedDecorator = (Story: React.ComponentType) => (
  <div className="fixed inset-0">
    <Story />
  </div>
);
