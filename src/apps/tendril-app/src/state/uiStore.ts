import { bridge } from "../api/bridge";
import { readAppearance } from "./appearance";
import {
  navigation,
  toAddressArgs,
  type AddressArgs,
  type NavigateTarget,
  type SessionPane,
} from "./navigation";

export interface UiState {
  /**
   * What the frame is showing: the active session pane's id while one is up, else the page. Owned by
   * {@link navigation} and mirrored here because it is the value the whole app already reads. When
   * TanStack Router lands, those readers move to its location hooks and this mirror goes with it.
   */
  activeNav: string;
  /** The page behind the session panes (V1's `currentApp`), which the `$page` tab reveals. */
  pageNav: string;
  /** V1's `appArgs` for the page: what a sidebar row's `buildSelectArgs` produced. */
  pageArgs: AddressArgs;
  /**
   * The open session panes: review-action runs, and agent terminals once V2 has them. Never pages -
   * V1's strip is the `$page` tab plus the sessions (`TendrilAppShell.BuildStripTabs`).
   */
  sessionTabs: SessionPane[];
  /** The pane on top, or null while the page is showing. */
  activeSessionId: string | null;
  /** V1's `client.Error(...)` for a history entry naming a pane that is gone. */
  navError: string | null;
  selectedPlanId: string | null;
  sidebarCollapsed: boolean;
  searchFilter: string;
  selectedStateFilter: string | null;
  selectedProjectFilter: string | null;
  dismissedUpdateVersion: string | null;
}

/** The half of {@link UiState} this store actually owns: preferences, not navigation. */
interface UiPreferences {
  /** The page to resume on a restart. Navigation persists nothing: the address is its home. */
  lastPageNav: string;
  selectedPlanId: string | null;
  sidebarCollapsed: boolean;
  searchFilter: string;
  selectedStateFilter: string | null;
  selectedProjectFilter: string | null;
  dismissedUpdateVersion: string | null;
}

const UI_STATE_KEY = "tendril_ui_preferences";

class UiStore {
  private prefs: UiPreferences = {
    lastPageNav: "plans",
    selectedPlanId: null,
    sidebarCollapsed: false,
    searchFilter: "",
    selectedStateFilter: null,
    selectedProjectFilter: null,
    dismissedUpdateVersion: null,
  };

  private listeners: Set<() => void> = new Set();
  private initialized = false;

  constructor() {
    // Navigation is the source of truth for where the app is, so its changes are this store's changes
    // as far as every existing subscriber is concerned.
    navigation.subscribe(() => {
      this.prefs.lastPageNav = navigation.getState().pageAppId;
      this.notify();
    });
  }

  public getState(): UiState {
    const nav = navigation.getState();
    return {
      activeNav: nav.activeNav,
      pageNav: nav.pageAppId,
      pageArgs: nav.pageArgs,
      sessionTabs: nav.sessions,
      activeSessionId: nav.activeSessionId,
      navError: nav.error,
      selectedPlanId: this.prefs.selectedPlanId,
      sidebarCollapsed: this.prefs.sidebarCollapsed,
      searchFilter: this.prefs.searchFilter,
      selectedStateFilter: this.prefs.selectedStateFilter,
      selectedProjectFilter: this.prefs.selectedProjectFilter,
      dismissedUpdateVersion: this.prefs.dismissedUpdateVersion,
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
    void this.persist();
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const saved = await bridge.loadUiState(UI_STATE_KEY);
      if (saved) {
        this.prefs = { ...this.prefs, ...(JSON.parse(saved) as Partial<UiPreferences>) };
      }
    } catch {
      // Fall back to memory state
    }

    // `config.yaml`'s `sidebarOpen` is the *session* default, so it is read here and it wins over the
    // persisted flag: V1's shell does `UseState(() => config.Settings.SidebarOpen)` on every build
    // and never writes a runtime toggle back, so a toggle lasts as long as the session and Appearance
    // decides where the next one starts. A failed read leaves the persisted value alone.
    try {
      const sidebarOpen = readAppearance(await bridge.getConfig()).sidebarOpen;
      this.prefs.sidebarCollapsed = !sidebarOpen;
    } catch {
      // Keep whatever was persisted.
    }

    // The address is where navigation lives, so it wins; the persisted page is only the fallback for
    // an address that names no app, which is a cold start on "/".
    navigation.start(this.prefs.lastPageNav);
    this.listeners.forEach((l) => l());
  }

  private async persist(): Promise<void> {
    try {
      // Session panes are deliberately not written: a restored pane would name a process that died
      // with the run that started it, which is why V1 holds its tabs in `UseState` and persists none.
      const json = JSON.stringify(this.prefs);
      await bridge.saveUiState(UI_STATE_KEY, json);
    } catch {
      // Ignore background persistence errors
    }
  }

  /** The navigation seam, for callers that carry args or a pane id. */
  public navigate(target: NavigateTarget): void {
    navigation.navigate(target);
  }

  /**
   * Navigates by app id, which is every nav row, tab and in-view link. Whether that opens the page or
   * a session pane is the seam's decision, not the caller's.
   */
  public setActiveNav(nav: string, args?: unknown): void {
    navigation.navigate({ appId: nav, args: args === undefined ? undefined : toAddressArgs(args) });
  }

  /** V1 `ShowPage`: reveals the page behind the panes, leaving every pane mounted. */
  public showPage(): void {
    navigation.showPage();
  }

  /** V1 `OnTabClose`. Only a session pane can be closed; a page is not a tab. */
  public closeTab(tabId: string): void {
    navigation.closeSession(tabId);
  }

  public clearNavError(): void {
    navigation.clearError();
  }

  /** Selecting a plan is a sidebar selection plus a page, not a tab. */
  public setSelectedPlanId(id: string | null): void {
    this.prefs.selectedPlanId = id;
    this.notify();
  }

  public setSearchFilter(query: string): void {
    this.prefs.searchFilter = query;
    this.notify();
  }

  public setStateFilter(stateFilter: string | null): void {
    this.prefs.selectedStateFilter = stateFilter;
    this.notify();
  }

  public setProjectFilter(projectFilter: string | null): void {
    this.prefs.selectedProjectFilter = projectFilter;
    this.notify();
  }

  public setDismissedUpdateVersion(version: string | null): void {
    this.prefs.dismissedUpdateVersion = version;
    this.notify();
  }
}

export const uiStore = new UiStore();
