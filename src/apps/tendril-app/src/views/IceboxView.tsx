import React, { useMemo, useState } from "react";
import { Snowflake, Search } from "lucide-react";
import type { PlanSummary, VerificationStatus } from "../types/api";
import { EmptyState } from "../components/EmptyState";
import { formatPlanId, parseProjects, planStateBadgeClass } from "./PlansView";

interface IceboxViewProps {
  plans: PlanSummary[];
  onSelectPlan: (planId: string) => void;
  onNewPlan?: () => void;
}

const VERIFICATION_DOT_CLASS: Record<VerificationStatus, string> = {
  Pass: "bg-success",
  Fail: "bg-destructive",
  Pending: "bg-muted-foreground/50",
  Skipped: "bg-muted-foreground/50",
};

export const IceboxView: React.FC<IceboxViewProps> = ({ plans, onSelectPlan }) => {
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<string>("all");

  const iceboxPlans = useMemo(() => {
    return plans.filter((p) => p.state === "Icebox");
  }, [plans]);

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const p of iceboxPlans) {
      for (const proj of parseProjects(p.project)) {
        set.add(proj);
      }
    }
    return Array.from(set).sort();
  }, [iceboxPlans]);

  const filtered = useMemo(() => {
    return iceboxPlans.filter((p) => {
      if (selectedProject !== "all") {
        const planProjects = parseProjects(p.project);
        if (!planProjects.includes(selectedProject)) return false;
      }

      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesTitle = p.title.toLowerCase().includes(query);
        const matchesId = p.id.includes(query);
        if (!matchesTitle && !matchesId) return false;
      }

      return true;
    });
  }, [iceboxPlans, selectedProject, search]);

  return (
    <div data-testid="icebox-view" className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Icebox</h1>
        <p className="text-sm text-muted-foreground">
          Archived and deferred plans placed on hold.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icebox plans..."
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>

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

      {/* Content */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Snowflake}
          title="No plans in icebox"
          description={
            search || selectedProject !== "all"
              ? "No icebox plans match the current filters."
              : "Plans marked with the Icebox state will appear here."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((plan) => {
            const projectList = parseProjects(plan.project);

            return (
              <div
                key={plan.id}
                data-testid={`icebox-plan-card-${plan.id}`}
                onClick={() => onSelectPlan(plan.id)}
                className="group flex cursor-pointer flex-col justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-ring hover:shadow-xs"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono font-semibold text-foreground">
                      {formatPlanId(plan.id)}
                    </span>
                    {plan.priority !== undefined && (
                      <span className="text-[11px] text-muted-foreground/80">
                        P{plan.priority}
                      </span>
                    )}
                  </div>

                  <h3 className="line-clamp-2 text-sm font-semibold text-foreground group-hover:text-primary">
                    {plan.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span
                      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${planStateBadgeClass(
                        plan.state,
                      )}`}
                    >
                      {plan.state}
                    </span>

                    {projectList.map((proj) => (
                      <span
                        key={proj}
                        className="inline-flex items-center rounded border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {proj}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Footer / Verifications */}
                <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
                  <span>{plan.level || "Feature"}</span>
                  {plan.verifications && plan.verifications.length > 0 && (
                    <div className="flex items-center gap-1">
                      {plan.verifications.map((v, i) => (
                        <span
                          key={i}
                          title={`${v.name}: ${v.status}`}
                          className={`h-2 w-2 rounded-full ${VERIFICATION_DOT_CLASS[v.status] || "bg-muted-foreground/50"}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
