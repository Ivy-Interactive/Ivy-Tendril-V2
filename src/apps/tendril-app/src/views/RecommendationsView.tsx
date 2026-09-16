import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, RefreshCw, Search, ExternalLink } from "lucide-react";
import {
  BadgeSelect,
  type BadgeSelectOption,
} from "@ivy-interactive/components/tendril";
import { bridge } from "../api/bridge";
import { describeBridgeError, type CrossPlanRecommendation, type RecommendationState } from "../types/api";
import { EmptyState } from "../components/EmptyState";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";
import { formatPlanId } from "./PlansView";

const STATUS_OPTIONS: BadgeSelectOption[] = [
  { value: "Pending", label: "Pending" },
  { value: "Accepted", label: "Accepted" },
  { value: "Declined", label: "Declined" },
];

export const REC_STATUS_CLASS: Record<string, string> = {
  Accepted: "bg-success/10 text-success border border-success/40",
  AcceptedWithNotes: "bg-success/10 text-success border border-success/40",
  Declined: "bg-muted text-muted-foreground border border-border",
  Pending: "bg-warning/10 text-warning border border-warning/40",
};

export const REC_IMPACT_CLASS: Record<string, string> = {
  High: "bg-success/10 text-success border border-success/40",
  Medium: "bg-warning/10 text-warning border border-warning/40",
};

export interface RecommendationsViewProps {
  onSelectPlan: (planId: string) => void;
  onJobStarted?: (res: { jobId: string }) => void;
}

export const RecommendationsView: React.FC<RecommendationsViewProps> = ({
  onSelectPlan,
  onJobStarted,
}) => {
  const [recommendations, setRecommendations] = useState<CrossPlanRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["Pending"]);
  const [selectedProject, setSelectedProject] = useState<string>("all");

  // Dialog state for Accept With Notes or Decline
  const [activeDialog, setActiveDialog] = useState<{
    rec: CrossPlanRecommendation;
    action: "Accept" | "Decline";
  } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await bridge.listCrossPlanRecommendations();
      setRecommendations(list);
      setError(null);
    } catch (err) {
      setError(`Failed to load recommendations: ${describeBridgeError(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const r of recommendations) {
      if (r.project) set.add(r.project);
    }
    return Array.from(set).sort();
  }, [recommendations]);

  const filtered = useMemo(() => {
    return recommendations.filter((r) => {
      const state = r.state || "Pending";
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(state)) {
        if (!selectedStatuses.includes("Accepted") || state !== "AcceptedWithNotes") {
          return false;
        }
      }

      if (selectedProject !== "all" && r.project !== selectedProject) {
        return false;
      }

      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesTitle = r.title.toLowerCase().includes(query);
        const matchesDesc = r.description.toLowerCase().includes(query);
        const matchesPlan = r.planTitle?.toLowerCase().includes(query) || r.planId.includes(query);
        if (!matchesTitle && !matchesDesc && !matchesPlan) {
          return false;
        }
      }

      return true;
    });
  }, [recommendations, selectedStatuses, selectedProject, search]);

  const handleSetState = async (
    rec: CrossPlanRecommendation,
    state: RecommendationState,
    noteOrReason?: string,
  ) => {
    setActionError(null);
    try {
      const declineReason = state === "Declined" ? noteOrReason : undefined;
      const notes = state === "AcceptedWithNotes" ? noteOrReason : undefined;
      await bridge.setRecommendationState(rec.planId, rec.title, state, declineReason, notes);

      // If accepted, also launch a CreatePlan job mirroring V1
      if (state === "Accepted" || state === "AcceptedWithNotes") {
        const desc = notes
          ? `[ORIGINAL RECOMMENDATION]\n${rec.description}\n\n[NOTES]\n${notes}`
          : rec.description;
        const res = await bridge.startJob({
          type: "CreatePlan",
          prompt: desc,
          project: rec.project,
        });
        if (res && onJobStarted) {
          onJobStarted(res);
        }
      }

      // Optimistically update local list
      setRecommendations((prev) =>
        prev.map((item) =>
          item.planId === rec.planId && item.title === rec.title
            ? { ...item, state, declineReason, notes }
            : item,
        ),
      );
    } catch (err) {
      setActionError(`Failed to update recommendation "${rec.title}": ${describeBridgeError(err)}`);
    }
  };

  return (
    <div data-testid="recommendations-view" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Recommendations</h1>
          <p className="text-sm text-muted-foreground">
            Follow-up tasks identified during plan execution waiting for operator review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="ml-2 font-bold">
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recommendations..."
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>

        <BadgeSelect
          options={STATUS_OPTIONS}
          value={selectedStatuses}
          onChange={setSelectedStatuses}
          multiple
          placeholder="Filter by status..."
        />

        {projects.length > 0 && (
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:border-ring focus:outline-none"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No recommendations"
          description={
            search || selectedStatuses.length > 0 || selectedProject !== "all"
              ? "No recommendations match the current filters."
              : "Recommendations from completed plans will appear here."
          }
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((rec) => {
            const statusKey = rec.state || "Pending";
            const badgeClass = REC_STATUS_CLASS[statusKey] ?? REC_STATUS_CLASS.Pending;
            const impactClass = rec.impact
              ? REC_IMPACT_CLASS[rec.impact] ?? "border border-border text-muted-foreground"
              : "border border-border text-muted-foreground";

            return (
              <div
                key={`${rec.planId}::${rec.title}`}
                data-testid={`recommendation-row-${rec.title}`}
                className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card/60 p-4 transition hover:border-border/80 sm:flex-row sm:items-start"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectPlan(rec.planId)}
                      className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary hover:underline"
                    >
                      <span>{formatPlanId(rec.planId)}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    {rec.project && (
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {rec.project}
                      </span>
                    )}
                    {rec.impact && (
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${impactClass}`}>
                        {rec.impact}
                      </span>
                    )}
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                      {statusKey}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-foreground">{rec.title}</h3>
                  <p className="text-xs text-muted-foreground">{rec.description}</p>

                  {rec.notes && (
                    <p className="text-xs text-muted-foreground/90">
                      <span className="font-semibold text-foreground">Notes: </span>
                      {rec.notes}
                    </p>
                  )}
                  {rec.declineReason && (
                    <p className="text-xs text-muted-foreground/90">
                      <span className="font-semibold text-foreground">Decline reason: </span>
                      {rec.declineReason}
                    </p>
                  )}
                </div>

                {/* Actions */}
                {statusKey === "Pending" && (
                  <div className="flex flex-wrap items-center gap-2 sm:self-center">
                    <button
                      type="button"
                      onClick={() => void handleSetState(rec, "Accepted")}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-xs transition hover:bg-primary/90"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDialog({ rec, action: "Accept" })}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
                    >
                      Accept with Notes
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDialog({ rec, action: "Decline" })}
                      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/20"
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Note dialog */}
      {activeDialog && (
        <RecommendationNoteDialog
          isOpen
          title={activeDialog.rec.title}
          action={activeDialog.action}
          onClose={() => setActiveDialog(null)}
          onSubmit={async (note) => {
            const rec = activeDialog.rec;
            const action = activeDialog.action;
            setActiveDialog(null);
            if (action === "Accept") {
              await handleSetState(rec, note ? "AcceptedWithNotes" : "Accepted", note);
            } else {
              await handleSetState(rec, "Declined", note);
            }
          }}
        />
      )}
    </div>
  );
};
