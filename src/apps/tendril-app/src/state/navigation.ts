import { useSyncExternalStore } from "react";
import { i18n } from "../i18n";

/**
 * The navigation seam: **one** `navigate({ appId, args, tabId })` plus a read of the current address.
 *
 * It matches the behaviour of V1's `AppShell/AppShellRouter.cs` without porting its shape. V1 returns
 * an action enum from a hand-written switch because that is what its shell needed; the same four
 * decisions are expressed here as URL state, which is what this stack expects:
 *
 * 1. **An address naming a session pane restores that pane.** Found → it comes to the front. Not
 *    found *and* the address was reached by history (back/forward) → an error, because silently
 *    opening something else would rewrite the user's history under them. This is V1's `TabId` rule,
 *    and it needs no `HistoryOp` of its own: `popstate` *is* the pop.
 * 2. **An address naming no app does nothing.**
 * 3. **An `allowDuplicateTabs` app opens as a session pane, keyed by its session id**, so reopening
 *    the same session reveals the pane already running it instead of spawning a second agent.
 * 4. **Everything else is the one page in the content frame.** A page is never a tab.
 *
 * This is deliberately *not* a router: no route matching, no route tree, no history stack of its own
 * (the browser's is the only one). TanStack Router is the intended implementation and is not
 * installed - the registry is unreachable from the dev sandbox - so adopting it is a change behind
 * this seam rather than a rewrite of every caller. What it would have to change:
 *
 * - `parseAddress` / `addressToUrl` become a route tree with `plans`, `plan/$planId`, `job/$jobId`
 *   and friends, and validated `search` schemas in place of {@link Address.args}.
 * - `navigate` becomes the router's own `navigate`, and rules 3 and 4 become which route a target
 *   matches rather than a branch here.
 * - {@link useNavigation} becomes the router's location hooks, and this module's subscription and
 *   `popstate` listener go with it.
 * - {@link SessionPane} stays: it is the shell's own pane registry, not routing state. Only its
 *   *active* member is addressable, which is V1's arrangement too.
 */

/** The fields of V1's `AppDescriptor` the shell reads. */
export interface AppDescriptor {
  id: string;
  /**
   * The page tab's title, in the current language: every registered app's is a getter that looks the
   * title up when it is read, so a registry built at import still follows a language change.
   */
  readonly title: string;
  /** V1's `[App(allowDuplicateTabs: true)]`: this app opens as a session pane, not as the page. */
  allowDuplicateTabs?: boolean;
  /**
   * This app draws to the frame's edges, so the shell's content container gives it no padding.
   *
   * V1 spells the same decision inside the widget tree: the host pads every app by 16px
   * (`AppHostWidget.tsx`: `p-4`) and an app opts out by putting `RemoveParentPadding()` on its root
   * layout, which the `:has(> .remove-parent-padding)` rules in the framework's `index.css` turn into
   * `padding: 0 !important` on the *parent*. It is all-or-nothing there, and all-or-nothing here.
   *
   * V2 has no widget tree and no `AppHostWidget`, so the equivalent has to be declared where the
   * shell can read it before it renders the page - which is here, beside the other two facts the
   * shell needs about an app. Keeping it in the registry rather than on each view's root `<div>` is
   * the point: one default, one explicit opt-out list, and {@link isFullBleedApp} as the single
   * question the shell asks. Scattered `p-*` classes on view roots are what made the padding
   * inconsistent in the first place.
   *
   * Note that several components ported from V1 still carry the literal `remove-parent-padding`
   * class on their root - `TendrilShell`, `PlanWorkspace`, `TendrilDashboard`, `WebViewer` - and
   * **it does nothing in V2**: no stylesheet here implements the `:has()` rules that give it meaning
   * in the framework. That inert class is why the drift went unnoticed; those components declared
   * themselves full-bleed and nothing was listening. This flag is what listens now.
   *
   * The set is V1's, verified against `Ivy-Tendril/src/Ivy.Tendril/Apps`. Chat, Plans (list and
   * detail), Review, ReviewAction and Agent say so with `RemoveParentPadding()`. Dashboard and
   * Settings say so implicitly, because the root widget each returns already carries the class
   * (`TendrilDashboard`'s `.tdb-root`, and `SidebarLayoutWidget` for `new SidebarLayout(...)`), and
   * each then re-applies an inset of its own inside. Jobs, Inbox, Recommendations, Pull Requests and
   * Icebox sit inside the 16px default - see the test in `tests/shell-content-padding.test.tsx` for
   * why V1's `HeaderLayout`/`FooterLayout` opt-outs do not change that.
   */
  fullBleed?: boolean;
}

/**
 * V1's app registry (`IAppRepository`, from the `[App]` attributes), reduced to what the shell needs:
 * a title for the page tab, and `allowDuplicateTabs` for the page-or-session decision.
 *
 * `review-action` is V1's `ReviewActionApp` (`isVisible: false, allowDuplicateTabs: true`): invisible
 * to the nav, opens as a session pane, and duplicates are allowed so a second action can run beside
 * the first. `agent` is V1's terminal app, listed so the rule that governs it is already in place
 * when V2 grows one.
 */
/**
 * V1's `TendrilAppShell.AgentAppId`. Named here rather than in the shell because two decisions read
 * it: the router opens this app as a session pane, and the bottom strip leaves it out - V1's
 * `IsAgentTab`, "Terminal panes are reached from the Chats list".
 */
export const AGENT_APP_ID = "agent";

/**
 * A registered app whose title is translated when it is read rather than when this module loads -
 * the registry is a module-level constant, and a string looked up at import would stay in whatever
 * language the app started in.
 */
const app = (
  id: string,
  title: () => string,
  flags: Pick<AppDescriptor, "allowDuplicateTabs" | "fullBleed"> = {},
): AppDescriptor => ({
  id,
  get title() {
    return title();
  },
  ...flags,
});

export const APP_DESCRIPTORS: Record<string, AppDescriptor> = {
  // Full-bleed for the same reason V1's is: `TendrilDashboard` is a full-bleed widget that owns its
  // own scroll (`.tdb-root { height: 100%; overflow-y: auto }`) and re-applies the host's inset
  // itself (`.tdb-inner { padding: 16px 16px 24px }`). Padding it here padded it twice and nested a
  // second scroll container inside the first.
  dashboard: app("dashboard", () => i18n.t("common:appTitles.dashboard"), { fullBleed: true }),
  plans: app("plans", () => i18n.t("common:appTitles.plans"), { fullBleed: true }),
  review: app("review", () => i18n.t("common:appTitles.review"), { fullBleed: true }),
  recommendations: app("recommendations", () => i18n.t("common:appTitles.recommendations")),
  jobs: app("jobs", () => i18n.t("common:appTitles.jobs")),
  chat: app("chat", () => i18n.t("common:appTitles.chat"), { fullBleed: true }),
  inbox: app("inbox", () => i18n.t("common:appTitles.inbox")),
  // V1 builds Settings as `new SidebarLayout(content, sidebar)`, and `SidebarLayoutWidget` carries
  // `remove-parent-padding` on its own root - so the section rail's `border-r` runs the full height
  // of the frame and the content pane supplies its own inset (`SettingsApp.cs:203`: `.Padding(4)`).
  // V2's view is built the same way and already pads its content pane, so padding the page as well
  // both doubled that inset and left the rail's divider floating off the frame's edges.
  settings: app("settings", () => i18n.t("common:appTitles.settings"), { fullBleed: true }),
  "pull-requests": app("pull-requests", () => i18n.t("common:appTitles.pullRequests")),
  icebox: app("icebox", () => i18n.t("common:appTitles.icebox")),
  "review-action": app("review-action", () => i18n.t("common:appTitles.reviewAction"), {
    allowDuplicateTabs: true,
    fullBleed: true,
  }),
  agent: app(AGENT_APP_ID, () => i18n.t("common:appTitles.agent"), {
    allowDuplicateTabs: true,
    fullBleed: true,
  }),
  /**
   * V1's `Apps/Debug/DialogsApp.cs`, which is `[App(icon: Icons.Bug, isVisible: false)]`.
   *
   * There is no `isVisible` field here and none is needed: the nav is built separately by
   * `buildNavItems` in `ShellLayout.tsx`, so an app is hidden by being registered here - which is
   * what gives it a tab title and a padding decision - and left out of that list. `review-action`
   * is hidden the same way. Reached by setting `activeNav` to `debug`.
   *
   * Padded, not full-bleed: the harness is an ordinary document-shaped view and takes the shell's
   * 16px like every other one.
   *
   * Its title stays English, untranslated, like the developer-only page it names (`DebugView`).
   */
  debug: { id: "debug", title: "Debug", fullBleed: false },
};

/** Where the shell starts, and where an address with no app leaves it. */
export const DEFAULT_APP_ID = "plans";

/**
 * V1's `appRepository.GetAppOrDefault(appId)`. The two id families V2 renders as pages without an app
 * of their own resolve here so the page tab can name them; both become routes with a param when the
 * router lands (`plan/$planId`, `job/$jobId`). V1 has no equivalent: a plan is `PlansApp` plus args,
 * and job output is a sheet over the jobs table (`Apps/Jobs/Sheets/OutputSheet.cs`), not a page.
 */
export const appDescriptor = (appId: string | null | undefined): AppDescriptor | undefined => {
  if (!appId) return undefined;
  const known = APP_DESCRIPTORS[appId];
  if (known) return known;
  if (appId.startsWith("plan-")) {
    // A plan page *is* V1's `PlansApp` with args, so it inherits `PlansApp`'s full-bleed frame:
    // `PlanWorkspace` draws its own topbar, tab strip and insets to the edges.
    return {
      id: appId,
      title: i18n.t("common:appTitles.plan", { id: appId.slice("plan-".length) }),
      fullBleed: true,
    };
  }
  if (appId.startsWith("job-")) {
    // Not full-bleed: V1 shows a job's output in a sheet over the Jobs table, and a sheet is inset.
    return { id: appId, title: i18n.t("common:appTitles.job", { id: appId.slice("job-".length) }) };
  }
  return undefined;
};

/**
 * Whether the shell's content container hands this app the frame's full area, unpadded - V1's
 * `RemoveParentPadding()`. See {@link AppDescriptor.fullBleed}. An unknown app is padded, which is
 * the host's default in both versions.
 */
export const isFullBleedApp = (appId: string | null | undefined): boolean =>
  appDescriptor(appId)?.fullBleed === true;

/**
 * Args as they travel in the address: flat and string-valued, because a search string is what they
 * round-trip through. Every publisher's `buildSelectArgs` result already has this shape
 * (`{ planId }`, `{ sessionId }`), which is V1's `PlansAppArgs` / `ChatAppArgs` unchanged.
 */
export type AddressArgs = Record<string, string>;

/** The address: V1's `NavigateArgs` as a URL rather than a record passed by hand. */
export interface Address {
  /** The path segment - the app the page is (`plans`, `plan-00074`, `job-42`). */
  appId: string;
  /** The search params, which are V1's `appArgs`. */
  args: AddressArgs;
  /** `?tab=` - the session pane on top. An open session is part of the address, as in V1. */
  tabId: string | null;
}

/** The search key the active session pane is addressed by. */
export const TAB_PARAM = "tab";

/** Coerces an arbitrary `buildSelectArgs` result into args a search string can carry. */
export const toAddressArgs = (args: unknown): AddressArgs => {
  if (typeof args !== "object" || args === null) return {};
  const result: AddressArgs = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (typeof value === "string") result[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") result[key] = String(value);
  }
  return result;
};

export const parseAddress = (pathname: string, search: string): Address => {
  const params = new URLSearchParams(search);
  const tabId = params.get(TAB_PARAM);
  params.delete(TAB_PARAM);
  return {
    appId: decodeURIComponent(pathname.replace(/^\/+/, "").split("/")[0] ?? ""),
    args: Object.fromEntries(params.entries()),
    tabId: tabId && tabId.length > 0 ? tabId : null,
  };
};

export const addressToUrl = (address: Address): string => {
  const params = new URLSearchParams(address.args);
  if (address.tabId) params.set(TAB_PARAM, address.tabId);
  const search = params.toString();
  return `/${encodeURIComponent(address.appId)}${search ? `?${search}` : ""}`;
};

/** One open session pane, V1's `TendrilAppShell.TabState`. */
export interface SessionPane {
  /** The pane's identity. V1 keys an agent pane by its chat session id, any other by a fresh guid. */
  id: string;
  appId: string;
  title: string;
  args: AddressArgs;
}

export interface NavigationState {
  /** The page in the content frame (V1's `currentApp`). */
  pageAppId: string;
  pageArgs: AddressArgs;
  sessions: SessionPane[];
  /** The pane on top, or null while the page is showing (V1's `selectedIndex`). */
  activeSessionId: string | null;
  /** What the frame is showing: the active session's id, else {@link NavigationState.pageAppId}. */
  activeNav: string;
  /** Rule 1's failure, V1's `client.Error("Tab no longer exists.")`. */
  error: string | null;
}

/** A navigation target: V1's `NavigateArgs`, minus the history bookkeeping the browser already does. */
export interface NavigateTarget {
  appId?: string | null;
  args?: AddressArgs | null;
  /** Names an existing session pane to bring forward. */
  tabId?: string | null;
  /** V1's `replaceHistory`: replace the current address instead of pushing a new one. */
  replace?: boolean;
}

const hasHistory = (): boolean =>
  typeof window !== "undefined" && typeof window.history?.pushState === "function";

class Navigation {
  private state: NavigationState = {
    pageAppId: DEFAULT_APP_ID,
    pageArgs: {},
    sessions: [],
    activeSessionId: null,
    activeNav: DEFAULT_APP_ID,
    error: null,
  };

  private listeners = new Set<() => void>();
  private detach: (() => void) | null = null;

  public getState = (): NavigationState => this.state;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(next: Partial<NavigationState>): void {
    const activeSessionId = next.activeSessionId ?? this.state.activeSessionId;
    const merged = { ...this.state, ...next };
    this.state = {
      ...merged,
      activeNav:
        "activeSessionId" in next && next.activeSessionId === null
          ? merged.pageAppId
          : (activeSessionId ?? merged.pageAppId),
    };
    this.listeners.forEach((listener) => listener());
  }

  /** Writes the address, which is the state's home; the browser keeps the history. */
  private writeAddress(address: Address, replace: boolean): void {
    if (!hasHistory()) return;
    const url = addressToUrl(address);
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }

  private currentAddress(): Address {
    if (typeof window === "undefined")
      return { appId: this.state.pageAppId, args: {}, tabId: null };
    return parseAddress(window.location.pathname, window.location.search);
  }

  /**
   * Attaches the seam to the address: adopts whatever is there now, then follows back/forward.
   *
   * @param fallbackAppId where an address that names no app lands, so a restart can resume the page
   *   the operator left (the shell's own preference, not something routing decides).
   */
  public start(fallbackAppId?: string): () => void {
    this.detach?.();
    const onPopState = () => this.syncFromAddress(true);
    if (typeof window !== "undefined") window.addEventListener("popstate", onPopState);
    this.detach = () => {
      if (typeof window !== "undefined") window.removeEventListener("popstate", onPopState);
      this.detach = null;
    };

    const address = this.currentAddress();
    if (!address.appId && fallbackAppId) {
      this.navigate({ appId: fallbackAppId, replace: true });
    } else {
      this.syncFromAddress(false);
    }
    return this.detach;
  }

  /**
   * Adopts the address. `isPop` is the browser's back/forward, which is the only case where an
   * address naming a pane that no longer exists is an error rather than something to move on from -
   * V1's `HistoryOp.Pop` arm, now supplied by the event instead of by a caller.
   */
  public syncFromAddress(isPop: boolean): void {
    const address = this.currentAddress();

    // Rule 1: an address naming a session pane restores it.
    if (address.tabId) {
      if (this.state.sessions.some((session) => session.id === address.tabId)) {
        this.set({ activeSessionId: address.tabId, error: null });
        return;
      }
      if (isPop) {
        this.set({ error: i18n.t("common:navigation.errors.tabGone") });
        return;
      }
      // A first load: the pane's process died with the session that started it, so the address is
      // rewritten to the page behind it rather than left pointing at nothing. V1 reasons the same way
      // about a reloaded terminal pane, which has no session to resume either.
      this.writeAddress({ ...address, tabId: null }, true);
    }

    // Rule 2: an address naming no app does nothing.
    if (!address.appId) return;

    // Rule 4 (rule 3 cannot be reached from an address alone: a session pane is created by an
    // explicit navigate, never by adopting a URL, or a reload would spawn a second agent).
    this.set({
      pageAppId: address.appId,
      pageArgs: address.args,
      activeSessionId: null,
      error: null,
    });
  }

  /** The seam. Every navigation in the app goes through this. */
  public navigate(target: NavigateTarget): void {
    const replace = target.replace === true;
    const args = target.args ?? {};

    // Rule 1: a named pane comes forward. A miss falls through to open something instead, since an
    // explicit navigate is not a history pop.
    if (target.tabId) {
      const existing = this.state.sessions.find((session) => session.id === target.tabId);
      if (existing) {
        this.set({ activeSessionId: existing.id, error: null });
        this.writeAddress(
          { appId: existing.appId, args: existing.args, tabId: existing.id },
          replace,
        );
        return;
      }
    }

    // Rule 2.
    if (!target.appId) return;

    const descriptor = appDescriptor(target.appId);

    // Rule 3: a session app opens a pane, keyed by its session id so the same session is revealed
    // rather than started twice.
    if (descriptor?.allowDuplicateTabs === true) {
      const sessionId = args.sessionId;
      const existing = sessionId
        ? this.state.sessions.find((session) => session.id === sessionId)
        : undefined;
      const pane: SessionPane = existing ?? {
        id: sessionId ?? `${target.appId}:${crypto.randomUUID()}`,
        appId: target.appId,
        title: descriptor.title,
        args,
      };
      this.set({
        sessions: existing ? this.state.sessions : [...this.state.sessions, pane],
        activeSessionId: pane.id,
        error: null,
      });
      this.writeAddress({ appId: pane.appId, args: pane.args, tabId: pane.id }, replace);
      return;
    }

    // Rule 4: the one page in the content frame. The panes stay mounted behind it.
    this.set({ pageAppId: target.appId, pageArgs: args, activeSessionId: null, error: null });
    this.writeAddress({ appId: target.appId, args, tabId: null }, replace);
  }

  /**
   * V1 `TendrilAppShell.ShowPage`: reveals the page behind the panes and leaves every pane mounted,
   * so a review action's terminal keeps running while the reviewer goes back to the plan.
   */
  public showPage(): void {
    if (this.state.activeSessionId === null) return;
    this.set({ activeSessionId: null, error: null });
    this.writeAddress(
      { appId: this.state.pageAppId, args: this.state.pageArgs, tabId: null },
      false,
    );
  }

  /**
   * V1 `TendrilAppShell.OnTabClose`: the neighbouring pane takes over, or the page behind them is
   * revealed when the last one goes.
   */
  public closeSession(sessionId: string): void {
    const index = this.state.sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return;

    const remaining = this.state.sessions.filter((session) => session.id !== sessionId);
    const wasActive = this.state.activeSessionId === sessionId;
    const next = wasActive ? remaining[Math.min(index, remaining.length - 1)] : undefined;

    this.set({
      sessions: remaining,
      activeSessionId: wasActive ? (next?.id ?? null) : this.state.activeSessionId,
      error: null,
    });

    if (!wasActive) return;
    this.writeAddress(
      next
        ? { appId: next.appId, args: next.args, tabId: next.id }
        : { appId: this.state.pageAppId, args: this.state.pageArgs, tabId: null },
      false,
    );
  }

  public clearError(): void {
    if (this.state.error === null) return;
    this.set({ error: null });
  }

  /** Test seam: the module instance outlives a render, and the address does too. */
  public resetForTesting(): void {
    this.detach?.();
    this.state = {
      pageAppId: DEFAULT_APP_ID,
      pageArgs: {},
      sessions: [],
      activeSessionId: null,
      activeNav: DEFAULT_APP_ID,
      error: null,
    };
    this.listeners.clear();
    if (hasHistory()) window.history.replaceState(null, "", "/");
  }
}

export const navigation = new Navigation();

export const useNavigation = (): NavigationState =>
  useSyncExternalStore(navigation.subscribe, navigation.getState, navigation.getState);
