import React, { useMemo, useState } from "react";
import { Flame, Search, Trash2 } from "lucide-react";
import { Badge, Button, NativeSelect } from "@ivy-interactive/components/ui";
import { plansStore } from "../state/plansStore";
import { describeBridgeError, type PlanSummary } from "../types/api";
import { VERIFICATION_DOT_CLASS } from "../utils/verificationStatus";
import { NoContentView } from "../components/NoContentView";
import { ErrorBanner } from "../components/ErrorBanner";
import { LevelBadge } from "../components/LevelBadge";
import { DeletePlanDialog } from "./dialogs";
import { formatPlanId, parseProjects, planStateBadgeVariant } from "./PlansView";
import { verificationStatusLabel } from "./PlanVerifications";
import { useTranslation } from "../i18n";
import { useEnumLabels } from "../i18n/enumLabels";

interface IceboxViewProps {
  plans: PlanSummary[];
  onSelectPlan: (planId: string) => void;
  /**
   * Told that a plan left the Icebox, so the host can refetch. Optional: the daemon's plan watcher
   * broadcasts the `plan.yaml` write anyway and `App.tsx` refetches on it, so this only shortens the
   * gap. The view does not depend on it — see `dismissed`.
   */
  onPlanChanged?: (planId: string) => void;
  /**
   * Accepted because `App.tsx` passes it, and deliberately not used: V1's `IceboxApp` has no New
   * Plan action, and its empty state is a bare `NoContentView` with no call to action. See the
   * report — the prop should be dropped at the call site rather than given a button here.
   */
  onNewPlan?: () => void;
}

/**
 * Plans on ice, and the two ways off it.
 *
 * V1's `Icebox/ContentView` action bar is Delete, Thaw, Execute and an overflow menu. Thaw and
 * Delete are here; Execute is not, because starting a job needs the preflight and dirty-repo
 * confirmation the host owns and a button that cannot honour those guards would execute against
 * `origin/<baseBranch>` without telling anyone (see the report).
 *
 * Thaw is the important one. `TransitionState(folderName, PlanStatus.Draft)` is the *only* route out
 * of `Icebox` in V1, and until this existed the state was a one-way door in V2: `DeletePlanDialog`
 * puts a plan in, and nothing took it out.
 */
export const IceboxView: React.FC<IceboxViewProps> = ({ plans, onSelectPlan, onPlanChanged }) => {
  const { t } = useTranslation("plans");
  const labels = useEnumLabels();
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [selectedLevel, setSelectedLevel] = useState<string>("all");

  /** Which plan an action is in flight on, so its own card is the only one that goes busy. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PlanSummary | null>(null);

  /**
   * Plans this view has taken off the ice, held until the host's list catches up.
   *
   * The card has to disappear on the click that thawed it. Waiting for the plan watcher to fire and
   * the store to refetch leaves an Icebox card claiming to be a Draft, and a second Thaw on it would
   * be a second write to a plan that already moved.
   *
   * `plansStore` now applies the same removal to its own list the moment the daemon confirms one, so
   * for a host that feeds `plans` from the store this is belt and braces. It is kept because the prop
   * is a plain array and this view does not require it to come from there — a caller passing a static
   * list still gets a card that disappears.
   */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const iceboxPlans = useMemo(
    () => plans.filter((p) => p.state === "Icebox" && !dismissed.has(p.id)),
    [plans, dismissed],
  );

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const p of iceboxPlans) {
      for (const proj of parseProjects(p.project)) {
        set.add(proj);
      }
    }
    return Array.from(set).sort();
  }, [iceboxPlans]);

  /**
   * V1's sidebar carries a Level select beside the Project one (`Icebox/SidebarView.BuildHeader`),
   * populated from the configured level names. V2 has no level config on this page, so the options
   * are the levels the icebox actually holds — which is also how the project select is built here.
   */
  const levels = useMemo(() => {
    const set = new Set<string>();
    for (const p of iceboxPlans) {
      if (p.level) set.add(p.level);
    }
    return Array.from(set).sort();
  }, [iceboxPlans]);

  const filtered = useMemo(() => {
    return iceboxPlans.filter((p) => {
      if (selectedProject !== "all") {
        const planProjects = parseProjects(p.project);
        if (!planProjects.includes(selectedProject)) return false;
      }

      if (selectedLevel !== "all" && p.level !== selectedLevel) return false;

      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesTitle = p.title.toLowerCase().includes(query);
        const matchesId = p.id.includes(query);
        if (!matchesTitle && !matchesId) return false;
      }

      return true;
    });
  }, [iceboxPlans, selectedProject, selectedLevel, search]);

  const forget = (planId: string) => {
    setDismissed((prev) => new Set(prev).add(planId));
    onPlanChanged?.(planId);
  };

  /**
   * `Icebox/ContentView`'s Thaw button: one state write back to Draft. V1 also announces the edit to
   * an attached chat session (`PlanEditAnnouncer.Announce`), which V2 has no counterpart for here.
   *
   * The failure path keeps the card: a plan that vanished and came back is worse than one that never
   * moved, and the daemon does refuse this write while a job holds the plan.
   */
  const thaw = async (plan: PlanSummary) => {
    if (pendingId != null) return;
    setPendingId(plan.id);
    setActionError(null);
    try {
      // Through the store for the same reason every other transition is: the thawed plan has to leave
      // the icebox — and join the Plans queue, and its nav badge — without waiting for a refetch. The
      // store confirms before it applies, so the failure path below still keeps the card.
      await plansStore.transitionPlanOptimistic(plan.id, "Draft");
      forget(plan.id);
    } catch (err) {
      setActionError(
        t("icebox.thawFailed", { id: formatPlanId(plan.id), error: describeBridgeError(err) }),
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div data-testid="icebox-view" className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("icebox.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("icebox.description")}</p>
      </div>

      {actionError && (
        <ErrorBanner onDismiss={() => setActionError(null)}>{actionError}</ErrorBanner>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("icebox.searchPlaceholder")}
            className="h-9 w-full rounded-field border border-border bg-background pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
          />
        </div>

        {projects.length > 0 && (
          <NativeSelect
            aria-label={t("icebox.projectFilterLabel")}
            wrapperClassName="w-auto"
            className="w-auto text-xs"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
          >
            <option value="all">{t("icebox.allProjects")}</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        )}

        {levels.length > 0 && (
          <NativeSelect
            aria-label={t("icebox.levelFilterLabel")}
            wrapperClassName="w-auto"
            className="w-auto text-xs"
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
          >
            <option value="all">{t("icebox.allLevels")}</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <NoContentView
          data-testid="icebox-empty"
          // `NoContentView("Icebox is empty", "Plans you put on ice will appear here")` is V1's copy
          // for an empty icebox; the filter message is the other case, when a filter hid a set that
          // is not empty. V1 passes this one no `cta`, so it carries no process wallpaper: the
          // pipeline has no icebox stage, and V1 hangs it only off Plans and Review.
          title={iceboxPlans.length === 0 ? t("icebox.empty.title") : t("icebox.noMatch.title")}
          description={
            iceboxPlans.length === 0
              ? t("icebox.empty.description")
              : t("icebox.noMatch.description")
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((plan) => {
            const projectList = parseProjects(plan.project);
            const isBusy = pendingId != null;

            return (
              <div
                key={plan.id}
                data-testid={`icebox-plan-card-${plan.id}`}
                className="group flex flex-col justify-between rounded-box border border-border bg-card p-4 transition-all hover:border-ring hover:shadow-xs"
              >
                {/* Only the summary opens the plan. The action row below must not: a click on Thaw
                    that also navigated away would hide its own failure banner. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectPlan(plan.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectPlan(plan.id);
                    }
                  }}
                  className="cursor-pointer space-y-2 text-left"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono font-semibold text-foreground">
                      {formatPlanId(plan.id)}
                    </span>
                    {plan.priority !== undefined && (
                      <span className="text-xs-tight text-muted-foreground/80">
                        {t("icebox.card.priority", { priority: plan.priority })}
                      </span>
                    )}
                  </div>

                  <h3 className="line-clamp-2 text-sm font-semibold text-foreground group-hover:text-primary">
                    {plan.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Badge variant={planStateBadgeVariant(plan.state)} density="Small">
                      {labels.planState(plan.state)}
                    </Badge>

                    {projectList.map((proj) => (
                      <Badge key={proj} variant="outline" density="Small">
                        {proj}
                      </Badge>
                    ))}

                    {/* `SidebarView.BuildRowBadges` ends with the level, after the projects, and
                        colours it from configuration. It used to be an uncoloured line in the card
                        footer, which is the one thing that badge exists to say. */}
                    <LevelBadge level={plan.level} density="Small" />
                  </div>
                </div>

                {/* Footer / Verifications. The level used to sit here as plain text and is now a
                    coloured badge above, so with no verification dots there is nothing left to rule
                    off — the border is drawn only when the row has content. */}
                {plan.verifications && plan.verifications.length > 0 && (
                  <div className="mt-4 flex items-center justify-end border-t border-border/50 pt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      {plan.verifications.map((v, i) => (
                        <span
                          key={i}
                          title={t("icebox.card.verificationTooltip", {
                            name: v.name,
                            status: verificationStatusLabel(t, v.status),
                          })}
                          className={`size-2 rounded-full ${VERIFICATION_DOT_CLASS[v.status] || "bg-muted-foreground/50"}`}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* V1's action bar order: Delete (outline), then Thaw (primary). */}
                <div className="mt-3 flex items-center gap-2">
                  {/* Both keep their per-plan `aria-label`: a page of frozen plans offering a
                      column of identical "Delete"s cannot be driven by voice or screen reader. */}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    aria-label={t("icebox.card.deleteLabel", { id: formatPlanId(plan.id) })}
                    onClick={() => setDeleting(plan)}
                    className="h-auto px-2.5 py-1 text-xs"
                  >
                    <Trash2 className="size-3.5" />
                    {t("common:actions.delete")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy}
                    aria-label={t("icebox.card.thawLabel", { id: formatPlanId(plan.id) })}
                    onClick={() => void thaw(plan)}
                    className="h-auto px-2.5 py-1 text-xs"
                  >
                    <Flame className="size-3.5" />
                    {pendingId === plan.id ? t("icebox.card.thawing") : t("icebox.card.thaw")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* V1's own `Icebox/Dialogs/DeletePlanDialog`: a bare permanent-delete confirm. The Plans
          page's Skip/Icebox alternatives are left out - the plan is already on ice. */}
      {deleting && (
        <DeletePlanDialog
          isOpen
          variant="icebox"
          plan={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={forget}
        />
      )}
    </div>
  );
};
