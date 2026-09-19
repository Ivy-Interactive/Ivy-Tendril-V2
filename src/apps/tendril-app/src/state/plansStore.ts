import { bridge } from "../api/bridge";
import type {
  PlanDetail,
  PlanLifecycleState,
  PlanQuery,
  PlanSummary,
  VerificationStatus,
} from "../types/api";

export interface PlansState {
  plans: PlanSummary[];
  selectedPlan: PlanDetail | null;
  isLoading: boolean;
  error: string | null;
}

class PlansStore {
  private state: PlansState = {
    plans: [],
    selectedPlan: null,
    isLoading: false,
    error: null,
  };

  private listeners: Set<() => void> = new Set();

  /**
   * Sequence numbers for the two fetches, so a slow answer cannot overwrite a newer one.
   *
   * V1 does not need these: `ContentView` reads plan content through `UseQuery` keyed on the plan's
   * folder path (`ContentView.cs`, `options: QueryScope.View`), and a query discards the result of a
   * key it is no longer on. Plain promises have no such key, so clicking plan A then plan B while A
   * is still in flight used to leave A's detail on screen under B's id.
   */
  private plansRequestSeq = 0;
  private detailRequestSeq = 0;
  /** The id `fetchPlanDetail` was last asked for. A reply for anything else is stale. */
  private detailRequestId: string | null = null;

  public getState(): PlansState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  public setPlans(plans: PlanSummary[]): void {
    this.state.plans = plans;
    this.notify();
  }

  public setSelectedPlan(plan: PlanDetail | null): void {
    this.state.selectedPlan = plan;
    this.notify();
  }

  public async fetchPlans(query?: PlanQuery): Promise<PlanSummary[]> {
    const seq = ++this.plansRequestSeq;
    this.state.isLoading = true;
    this.state.error = null;
    this.notify();

    try {
      const plans = await bridge.listPlans(query);
      // A newer list is already the truth. The caller still gets what it asked for; the store does
      // not go backwards.
      if (seq !== this.plansRequestSeq) return plans;
      this.state.plans = plans;
      this.state.isLoading = false;
      this.notify();
      return plans;
    } catch (err) {
      if (seq !== this.plansRequestSeq) throw err;
      this.state.isLoading = false;
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  /**
   * The plan the detail view renders.
   *
   * A reply is applied only while it is still the plan that was last asked for. Every plan event
   * refreshes the selection (`App.tsx`), so a plan opened during another plan's in-flight fetch would
   * otherwise be replaced by the older answer arriving second and the header would name one plan
   * while the body showed another.
   */
  public async fetchPlanDetail(id: string): Promise<PlanDetail> {
    const seq = ++this.detailRequestSeq;
    this.detailRequestId = id;
    this.state.isLoading = true;
    this.state.error = null;
    this.notify();

    try {
      const detail = await bridge.getPlan(id);
      if (seq !== this.detailRequestSeq) return detail;
      this.state.selectedPlan = detail;
      this.state.isLoading = false;
      this.notify();
      return detail;
    } catch (err) {
      if (seq !== this.detailRequestSeq) throw err;
      this.state.isLoading = false;
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  /** The plan `fetchPlanDetail` is currently on, for callers that need to know a reply is theirs. */
  public get pendingDetailId(): string | null {
    return this.detailRequestId;
  }

  public async updateFieldOptimistic(
    id: string,
    field: string,
    value: string,
    allowFailed?: boolean,
  ): Promise<void> {
    // 1. Snapshot previous state for rollback
    const previousPlans = [...this.state.plans];
    const previousDetail = this.state.selectedPlan ? { ...this.state.selectedPlan } : null;

    // 2. Apply optimistic updates
    this.state.plans = this.state.plans.map((p) => {
      if (p.id === id) {
        const updated = { ...p };
        if (field === "state") updated.state = value as PlanLifecycleState;
        if (field === "title") updated.title = value;
        if (field === "project") updated.project = value;
        if (field === "level") updated.level = value;
        return updated;
      }
      return p;
    });

    if (this.state.selectedPlan && this.state.selectedPlan.id === id) {
      const updatedDetail = { ...this.state.selectedPlan };
      if (field === "state") updatedDetail.state = value as PlanLifecycleState;
      if (field === "title") updatedDetail.title = value;
      if (field === "project") updatedDetail.project = value;
      if (field === "level") updatedDetail.level = value;
      this.state.selectedPlan = updatedDetail;
    }
    this.notify();

    // 3. Dispatch to native backend
    try {
      await bridge.updatePlanField(id, field, value, allowFailed);
    } catch (err) {
      // 4. Rollback on failure
      this.state.plans = previousPlans;
      this.state.selectedPlan = previousDetail;
      this.state.error = `Rollback: Failed to update ${field}: ${err instanceof Error ? err.message : String(err)}`;
      this.notify();
      throw err;
    }
  }

  public async updateVerificationOptimistic(
    planId: string,
    verificationName: string,
    newStatus: VerificationStatus,
  ): Promise<void> {
    const previousPlans = [...this.state.plans];
    const previousDetail = this.state.selectedPlan ? { ...this.state.selectedPlan } : null;

    // Optimistically update
    if (this.state.selectedPlan && this.state.selectedPlan.id === planId) {
      const vers = this.state.selectedPlan.verifications.map((v) =>
        v.name === verificationName ? { ...v, status: newStatus } : v,
      );
      this.state.selectedPlan = { ...this.state.selectedPlan, verifications: vers };
    }

    this.state.plans = this.state.plans.map((p) => {
      if (p.id === planId) {
        const vers = p.verifications.map((v) =>
          v.name === verificationName ? { ...v, status: newStatus } : v,
        );
        return { ...p, verifications: vers };
      }
      return p;
    });
    this.notify();

    try {
      await bridge.setVerificationStatus(planId, verificationName, newStatus);
    } catch (err) {
      this.state.plans = previousPlans;
      this.state.selectedPlan = previousDetail;
      this.state.error = `Rollback verification update: ${err instanceof Error ? err.message : String(err)}`;
      this.notify();
      throw err;
    }
  }
}

export const plansStore = new PlansStore();
