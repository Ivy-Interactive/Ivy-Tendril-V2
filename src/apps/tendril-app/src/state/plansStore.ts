import { bridge } from "../api/bridge";
import { i18n } from "../i18n";
import { isQueuedState } from "../utils/planQueues";
import type {
  PlanDetail,
  PlanLifecycleState,
  PlanQuery,
  PlanSummary,
  VerificationStatus,
} from "../types/api";

/**
 * Whether `plan` is the plan `id` names.
 *
 * `PlanSelectionHelper.ResolveSelection` accepts three spellings of the same plan, because the id
 * reaches it from three places: `p.FolderName.Equals(saved)`, `p.Id.ToString() == saved` and
 * `p.FolderName.StartsWith(saved + "-")` — an app's args carry `00021-SomePlan`, a row carries the
 * folder and a link carries the bare number. The numeric comparison here covers all three, since
 * `parseInt` reads the leading id off a folder name.
 */
export const isPlanId = (plan: PlanSummary, id: string): boolean => {
  if (plan.id.toLowerCase() === id.toLowerCase()) return true;
  const left = Number.parseInt(plan.id, 10);
  const right = Number.parseInt(id, 10);
  return !Number.isNaN(left) && !Number.isNaN(right) && left === right;
};

/**
 * Which plan an app opens on, ported from V1's `Helpers/PlanSelectionHelper.cs`.
 *
 * V1 calls this on **every** `Build()` of both `PlansApp` and `ReviewApp` — it is not a mount-time
 * seed — and its three branches are, in order:
 *
 * 1. the saved plan, if it is still in the list
 *    (`currentPlans.FirstOrDefault(p => p.FolderName.Equals(selected.FolderName) || p.Id == selected.Id)`);
 * 2. failing that, whatever now sits at the **same index** it used to
 *    (`var newIndex = oldIndex >= 0 ? Math.Min(oldIndex, currentPlans.Count - 1) : 0`), so clearing a
 *    queue works down it instead of bouncing back to the top after every decision;
 * 3. and with nothing saved at all, the first plan:
 *    `if (currentSelected == null && currentPlans.Count > 0 && ...) return (currentPlans[0], ...)`.
 *
 * Both callers order the list `.OrderByDescending(p => p.Id)`, so "the first plan" is the **highest
 * id**: the latest plan, not the most recently touched one. An empty list selects nothing, which is
 * what puts V1 on its `NoContentView`.
 *
 * It lives in the store rather than in `PlansView`, where it used to, because the shell needs it too
 * and every view is `React.lazy`: importing it out of a view would pull that view and its dialogs
 * into the initial chunk, which is the same reason `utils/planQueues` exists. `PlansView` re-exports
 * it, so the many call sites that import it from there are unaffected.
 *
 * @param plans the app's own filtered, newest-first list.
 * @param savedId the plan the app already had selected, or the one its args named.
 * @param previousPlans the list as it was on the previous build, for branch 2.
 */
export const resolvePlanSelection = (
  plans: PlanSummary[],
  savedId: string | null | undefined,
  previousPlans: readonly PlanSummary[] = [],
): PlanSummary | null => {
  if (plans.length === 0) return null;
  if (!savedId) return plans[0];

  const match = plans.find((plan) => isPlanId(plan, savedId));
  if (match) return match;

  const oldIndex = previousPlans.findIndex((plan) => isPlanId(plan, savedId));
  return plans[oldIndex >= 0 ? Math.min(oldIndex, plans.length - 1) : 0];
};

/**
 * The plan a queue advances to once `removedId` leaves it: **the one that is now at the index the
 * departing plan held**, clamped to the end, and nothing at all once the queue is empty.
 *
 * This is the one rule behind every primary CTA that takes a plan out of the queue it was sitting in
 * — Execute, Complete, Delete, Move to Skipped, Move to Icebox — and it is branch 2 of
 * {@link resolvePlanSelection} with the arguments it has always needed: the queue *including* the
 * departing plan, so its index is still there to be read. Passing the post-removal queue instead is
 * what silently dropped the whole rule, because branch 2 cannot fire without the previous list.
 *
 * Deleting #3 of [#9, #7, #3, #1] therefore opens #1, and deleting the last plan opens the one
 * before it, so clearing a queue works down it rather than bouncing back to the newest plan after
 * every decision.
 *
 * @param queue the queue as it was *before* the plan left it, newest first.
 * @param removedId the plan that is leaving.
 */
export const nextAfterRemoval = (
  queue: readonly PlanSummary[],
  removedId: string,
): PlanSummary | null =>
  resolvePlanSelection(
    queue.filter((plan) => !isPlanId(plan, removedId)),
    removedId,
    queue,
  );

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
  /**
   * Plans this store has removed locally and the daemon has already confirmed gone, held until a
   * `listPlans` answer agrees they are gone.
   *
   * The sequence numbers above solve one half of the resurrection problem: bumping
   * {@link plansRequestSeq} on a removal makes every list read that was *already in flight* stale, so
   * an answer computed before the delete cannot write the row back. They cannot solve the other half.
   * A read issued after the removal still reaches a daemon that may not have finished committing it,
   * and that answer is the newest one by every measure the sequence number has — so it wins, and the
   * row the operator just deleted reappears for a frame. Two frames later the plan watcher fires and
   * it goes again, which reads as a flicker and, worse, as a row that can still be clicked.
   *
   * A tombstone closes it from the other side: the store simply refuses to hold a plan it knows is
   * gone. It clears itself the first time a list omits the id, so nothing here outlives the
   * disagreement it exists to settle, and a plan that is genuinely recreated under the same id comes
   * back with it.
   */
  private readonly removedPlanIds = new Set<string>();

  /**
   * The same guarantee for a plan that moved rather than went: the state this store has already seen
   * the daemon accept, held until a list read reports it.
   *
   * A transition needs it for exactly the reason a removal does. Every queue in the app is derived
   * from `state.plans` by state (`utils/planQueues`), so a list answer that still calls a completed
   * plan `Review` puts it back in the review queue and back in the shell's badge — the same flicker,
   * reached without deleting anything. Several actions also refetch from more than one place at once
   * (`App.tsx`'s `onPlanChanged` alongside this store's own reconcile), so "the newest read wins" is
   * not enough on its own: both reads are newer than the write.
   */
  private readonly pendingStates = new Map<string, PlanLifecycleState>();

  /** The list as it was before the last removal or transition. See {@link listIncluding}. */
  private plansBeforeChange: PlanSummary[] = [];
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
    // An explicit seed is the caller asserting the whole list, which is a stronger statement than any
    // tombstone this store is still carrying — and than any index it remembered from before the seed.
    this.removedPlanIds.clear();
    this.pendingStates.clear();
    this.plansBeforeChange = [];
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
      // not go backwards. A stale answer is still filtered, because handing a caller a plan this
      // store has already removed is the same lie whether or not it lands in the state.
      if (seq !== this.plansRequestSeq) return this.reconcile(plans);
      // Only the authoritative answer gets to retire a pin, so a straggler that happens to agree
      // cannot vouch for a write the daemon has not finished committing.
      this.forgetSettled(plans);
      const reconciled = this.reconcile(plans);
      this.state.plans = reconciled;
      this.state.isLoading = false;
      this.notify();
      return reconciled;
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

  /** An incoming list with the outcomes this store has already had confirmed re-applied to it. */
  private reconcile(plans: PlanSummary[]): PlanSummary[] {
    if (this.removedPlanIds.size === 0 && this.pendingStates.size === 0) return plans;
    return plans
      .filter((plan) => !this.removedPlanIds.has(plan.id))
      .map((plan) => {
        const pending = this.pendingStates.get(plan.id);
        return pending && plan.state !== pending ? { ...plan, state: pending } : plan;
      });
  }

  /** Retires every pin the daemon's own list already agrees with. */
  private forgetSettled(plans: PlanSummary[]): void {
    for (const id of this.removedPlanIds) {
      if (!plans.some((plan) => plan.id === id)) this.removedPlanIds.delete(id);
    }
    for (const [id, state] of this.pendingStates) {
      const row = plans.find((plan) => plan.id === id);
      // A plan the list no longer carries at all has left by some other route, and there is nothing
      // left for the pin to protect.
      if (!row || row.state === state) this.pendingStates.delete(id);
    }
  }

  /**
   * Everything an in-flight list read could still say about the plans, discarded.
   *
   * Called by both mutators below for the reason on {@link removedPlanIds}: a `listPlans` that was
   * issued before the write is answering a question about a world that no longer exists, and
   * `fetchPlans` has no other way to know that — its own sequence check only compares list reads
   * against each other.
   */
  private invalidateInFlightPlanReads(): void {
    this.plansRequestSeq += 1;
  }

  /**
   * The list to measure a departing plan's position in, which is the list as it was **before** the
   * action rather than after it.
   *
   * {@link nextAfterRemoval} needs the index the plan held, and by the time a caller can ask, the
   * plan is already gone from `state.plans` — and, in the Plans case, the page that could have
   * remembered the index unmounted three navigations ago when the plan was opened. The store is the
   * one thing on that path that survives, so it keeps the snapshot.
   *
   * Falls back to the current list for a plan no recent action touched, which is what makes this
   * usable for Execute too: starting a job removes nothing from the list, it only makes the queue
   * filter hide the plan.
   */
  public listIncluding(planId: string): PlanSummary[] {
    const before = this.plansBeforeChange.find((plan) => plan.id === planId);
    const current = this.state.plans.find((plan) => plan.id === planId);
    // The snapshot is only worth reaching for while it still says something the live list does not.
    // Anything else — including a snapshot left over from an action on a different plan — is one
    // action out of date, so the live list is the better answer.
    if (before && (!current || current.state !== before.state)) return [...this.plansBeforeChange];
    return [...this.state.plans];
  }

  /**
   * Deletes a plan and drops it from the list the moment the daemon confirms it.
   *
   * "Optimistic" here is about the **refetch**, not about the daemon's answer: unlike
   * {@link updateFieldOptimistic} this applies nothing before the bridge resolves, because
   * `DeletePlanDialog` keeps the dialog open on a refusal and a plan that vanished from the list and
   * then came back is a lie the operator may act on. What it does not do is wait for `fetchPlans` to
   * come back before the row disappears — that round trip is the whole of the delay the operator
   * reads as "delete does not work", and it is why the reconcile below is fired and not awaited.
   *
   * Same ordering as `jobsStore.deleteJob`, which solves the identical problem for jobs: await the
   * bridge, mutate locally, notify, then reconcile in the background.
   */
  public async removePlanOptimistic(id: string): Promise<void> {
    // Not inside a try: nothing has been applied yet, so a rejection needs no rollback and — unlike
    // the two `*Optimistic` writers below — must not post a `Rollback:` banner over a dialog that is
    // already showing the daemon's own message.
    await bridge.deletePlan(id);

    this.plansBeforeChange = this.state.plans;
    this.removedPlanIds.add(id);
    // A plan that is gone has no state left to pin, and leaving one behind would keep re-adding it to
    // a list the filter above has already emptied of it.
    this.pendingStates.delete(id);
    this.invalidateInFlightPlanReads();
    this.state.plans = this.state.plans.filter((plan) => plan.id !== id);
    if (this.state.selectedPlan?.id === id) {
      // The detail of a deleted plan is a ghost, and leaving it in place would also convince
      // `App.tsx`'s plan-nav effect that the next plan is already loaded.
      this.state.selectedPlan = null;
      this.detailRequestId = null;
    }
    this.notify();

    // `refreshPlans()`, which every one of V1's mutating actions ends with. Unawaited because the
    // list above is already right; this only settles anything the delete changed indirectly.
    this.fetchPlans().catch(() => {});
  }

  /**
   * Moves a plan to another lifecycle state and patches it into the list the moment the daemon
   * confirms it.
   *
   * The counterpart of {@link removePlanOptimistic} for the CTAs that take a plan out of a queue
   * without deleting it — Complete, Move to Skipped, Move to Icebox, Thaw — and confirm-then-apply
   * for the same reason: every one of them is answered from a dialog or a card that stays put and
   * reports a refusal, so a row must not move before the daemon has agreed to move it.
   *
   * The queues are derived from `state.plans` by state (`utils/planQueues`), so patching the row here
   * is what takes the plan out of the Plans or Review list, and out of the shell's nav badge with it.
   */
  public async transitionPlanOptimistic(
    id: string,
    state: PlanLifecycleState,
    allowFailed?: boolean,
  ): Promise<void> {
    await bridge.updatePlanField(id, "state", state, allowFailed);

    this.planTransitioned(id, state);

    this.fetchPlans().catch(() => {});
  }

  /**
   * The row as it stands once a transition the daemon **has already agreed to** is applied, with no
   * bridge call and no fetch of its own.
   *
   * {@link transitionPlanOptimistic}'s second half, factored out for {@link resetPlanOptimistic},
   * which reaches the same place through a different route. Pinning the state is the part that
   * matters and the part that is easy to lose: `pendingStates` holds the row at the state the daemon
   * confirmed until a list read agrees, so the refetch fired on the next line cannot answer from a
   * snapshot taken before the write and put the plan back in the queue it just left.
   */
  private planTransitioned(id: string, state: PlanLifecycleState): void {
    // Only for a move that takes the plan out of **every** queue. A snapshot is the one thing here
    // that nothing retires — its only clearers are `setPlans` and the test seam below, and no
    // production path calls either — so the most recent one survives until the next, and
    // {@link listIncluding}'s state-difference guard is then guaranteed to prefer it. That is
    // harmless for a departure, whose caller consumes the snapshot on the same tick, and wrong for an
    // arrival: Reset and Thaw both land on `Draft`, which is a queue the plan is now *in*, so the live
    // list still holds its index and nobody asks for the old one. The snapshot they left behind was
    // consumed by whatever the operator did next — Update Plan on a just-reset plan measured a queue
    // the plan was still recorded `Review` in, found it absent, and bounced to the Plans page instead
    // of opening the next draft.
    if (!isQueuedState(state)) this.plansBeforeChange = this.state.plans;
    this.pendingStates.set(id, state);
    this.invalidateInFlightPlanReads();
    this.state.plans = this.state.plans.map((plan) => (plan.id === id ? { ...plan, state } : plan));
    if (this.state.selectedPlan?.id === id) {
      this.state.selectedPlan = { ...this.state.selectedPlan, state };
    }
    this.notify();
  }

  /**
   * Sends a plan back to Draft and patches the row the moment the daemon confirms it.
   *
   * {@link transitionPlanOptimistic} for the one CTA that cannot use it: `POST /plans/:id/reset` is
   * not a field write — it removes the plan's worktrees in the same request, so it has its own route
   * and its own bridge call — but the state it lands on is fixed. `reset_plan_handler` writes
   * `PlanStatus::Draft` unconditionally, having already refused a Completed or Skipped plan with a
   * 409, so the caller does not have to be told which state to pin.
   *
   * Reset is the one queue departure that is also an arrival: the plan leaves Review and joins the
   * Plans queue. Both ends of that are this one patch, because every queue is derived from
   * `state.plans` by state (`utils/planQueues`).
   */
  public async resetPlanOptimistic(id: string): Promise<void> {
    await bridge.resetPlan(id);

    this.planTransitioned(id, "Draft");

    this.fetchPlans().catch(() => {});
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
      // `field` is the plan.yaml key, an identifier; only the sentence around it is translated.
      this.state.error = i18n.t("plans:store.rollbackField", {
        field,
        error: err instanceof Error ? err.message : String(err),
      });
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
      this.state.error = i18n.t("plans:store.rollbackVerification", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.notify();
      throw err;
    }
  }

  /**
   * Test seam: vitest keeps one module instance per file, and this store outlives a render.
   *
   * {@link setPlans} is not that seam even though it clears three of these fields, because the
   * private request bookkeeping is deliberately not part of what asserting a list means. The one that
   * bites is {@link detailRequestId}: `App.tsx`'s plan-nav effect skips its fetch when the store is
   * already asking for that id, so a previous test's last `fetchPlanDetail` leaves the next test's
   * navigation to the same plan silently doing nothing, and it fails on an empty selection rather
   * than on what it was written to check.
   */
  public resetForTesting(): void {
    this.state = { plans: [], selectedPlan: null, isLoading: false, error: null };
    this.plansRequestSeq = 0;
    this.detailRequestSeq = 0;
    this.detailRequestId = null;
    this.plansBeforeChange = [];
    this.removedPlanIds.clear();
    this.pendingStates.clear();
    this.listeners.clear();
  }
}

export const plansStore = new PlansStore();
