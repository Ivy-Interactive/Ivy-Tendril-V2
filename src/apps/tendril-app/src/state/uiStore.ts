import { bridge } from "../api/bridge";

export interface UiState {
  activeNav: string;
  selectedPlanId: string | null;
  activeTabIds: string[];
  sidebarCollapsed: boolean;
  searchFilter: string;
  selectedStateFilter: string | null;
  selectedProjectFilter: string | null;
  dismissedUpdateVersion: string | null;
}

const UI_STATE_KEY = "tendril_ui_preferences";

class UiStore {
  private state: UiState = {
    activeNav: "plans",
    selectedPlanId: null,
    activeTabIds: ["plans"],
    sidebarCollapsed: false,
    searchFilter: "",
    selectedStateFilter: null,
    selectedProjectFilter: null,
    dismissedUpdateVersion: null,
  };

  private listeners: Set<() => void> = new Set();
  private initialized = false;

  public getState(): UiState {
    return this.state;
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
        const parsed = JSON.parse(saved);
        this.state = { ...this.state, ...parsed };
        this.listeners.forEach((l) => l());
      }
    } catch {
      // Fall back to memory state
    }
  }

  private async persist(): Promise<void> {
    try {
      const json = JSON.stringify({
        activeNav: this.state.activeNav,
        selectedPlanId: this.state.selectedPlanId,
        activeTabIds: this.state.activeTabIds,
        sidebarCollapsed: this.state.sidebarCollapsed,
        selectedStateFilter: this.state.selectedStateFilter,
        selectedProjectFilter: this.state.selectedProjectFilter,
        dismissedUpdateVersion: this.state.dismissedUpdateVersion,
      });
      await bridge.saveUiState(UI_STATE_KEY, json);
    } catch {
      // Ignore background persistence errors
    }
  }

  public setActiveNav(nav: string): void {
    this.state.activeNav = nav;
    if (!this.state.activeTabIds.includes(nav)) {
      this.state.activeTabIds.push(nav);
    }
    this.notify();
  }

  public setSelectedPlanId(id: string | null): void {
    this.state.selectedPlanId = id;
    if (id && !this.state.activeTabIds.includes(`plan-${id}`)) {
      this.state.activeTabIds.push(`plan-${id}`);
    }
    this.notify();
  }

  public openTab(tabId: string): void {
    if (!this.state.activeTabIds.includes(tabId)) {
      this.state.activeTabIds.push(tabId);
    }
    this.notify();
  }

  public closeTab(tabId: string): void {
    this.state.activeTabIds = this.state.activeTabIds.filter((t) => t !== tabId);
    if (this.state.activeNav === tabId) {
      this.state.activeNav = this.state.activeTabIds[0] || "dashboard";
    }
    this.notify();
  }

  public toggleSidebar(): void {
    this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
    this.notify();
  }

  public setSearchFilter(query: string): void {
    this.state.searchFilter = query;
    this.notify();
  }

  public setStateFilter(stateFilter: string | null): void {
    this.state.selectedStateFilter = stateFilter;
    this.notify();
  }

  public setProjectFilter(projectFilter: string | null): void {
    this.state.selectedProjectFilter = projectFilter;
    this.notify();
  }

  public setDismissedUpdateVersion(version: string | null): void {
    this.state.dismissedUpdateVersion = version;
    this.notify();
  }
}

export const uiStore = new UiStore();
