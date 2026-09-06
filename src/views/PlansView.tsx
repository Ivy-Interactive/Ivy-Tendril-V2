import React, { useState, useMemo, useRef, useEffect } from "react";
import { BadgeSelect, type BadgeSelectOption } from "components-storybook/tendril";
import type { PlanSummary } from "../types/api";
import { EmptyState } from "../components/EmptyState";

interface PlansViewProps {
  plans: PlanSummary[];
  onSelectPlan: (planId: string) => void;
  onNewPlan?: () => void;
}

const LIFECYCLE_OPTIONS: BadgeSelectOption[] = [
  { value: "Draft", label: "Draft" },
  { value: "Creating", label: "Creating" },
  { value: "Updating", label: "Updating" },
  { value: "Executing", label: "Executing" },
  { value: "Review", label: "Review" },
  { value: "Failed", label: "Failed" },
  { value: "Completed", label: "Completed" },
  { value: "Skipped", label: "Skipped" },
  { value: "Blocked", label: "Blocked" },
  { value: "Icebox", label: "Icebox" },
];

export const PlansView: React.FC<PlansViewProps> = ({
  plans,
  onSelectPlan,
  onNewPlan,
}) => {
  const [search, setSearch] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus shortcut '/'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredPlans = useMemo(() => {
    return plans.filter((p) => {
      if (selectedStates.length > 0 && !selectedStates.includes(p.state)) {
        return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          p.id.toLowerCase().includes(q) ||
          p.title.toLowerCase().includes(q) ||
          p.project.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [plans, selectedStates, search]);

  // Arrow key navigation
  useEffect(() => {
    const handleNavigation = (e: KeyboardEvent) => {
      if (filteredPlans.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredPlans.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev <= 0 ? filteredPlans.length - 1 : prev - 1
        );
      } else if (e.key === "Enter" && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        const selected = filteredPlans[selectedIndex];
        if (selected) {
          onSelectPlan(selected.id);
        }
      }
    };
    window.addEventListener("keydown", handleNavigation);
    return () => window.removeEventListener("keydown", handleNavigation);
  }, [filteredPlans, selectedIndex, onSelectPlan]);

  return (
    <div className="space-y-6" data-testid="plans-view">
      {/* Search and Filters bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            ref={searchInputRef}
            type="text"
            role="searchbox"
            aria-label="Search plans"
            placeholder="Search plans by title, ID, or project... (Press / to focus)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <div className="min-w-[180px]">
            <BadgeSelect
              id="state-filter"
              options={LIFECYCLE_OPTIONS}
              value={selectedStates}
              placeholder="Filter by state..."
              multiple={true}
              eventHandler={(_evt, _id, args) => {
                if (args && Array.isArray(args[0])) {
                  setSelectedStates(args[0] as string[]);
                }
              }}
            />
          </div>
          {onNewPlan && (
            <button
              type="button"
              onClick={onNewPlan}
              aria-label="New Plan"
              className="flex items-center space-x-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              <span>+</span>
              <span>New Plan</span>
            </button>
          )}
        </div>
      </div>

      {/* Plans List or Empty State */}
      {filteredPlans.length === 0 ? (
        <EmptyState
          title="No plans found"
          description={
            search || selectedStates.length > 0
              ? "No plans match your current search query or filter criteria."
              : "No plans are registered in the current Tendril workspace."
          }
          actionLabel={onNewPlan ? "Create Your First Plan" : undefined}
          onAction={onNewPlan}
        />
      ) : (
        <div
          role="list"
          aria-label="Plans list"
          className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
        >
          {filteredPlans.map((p, idx) => {
            const isHighlighted = idx === selectedIndex;
            return (
              <div
                key={p.id}
                role="listitem"
                tabIndex={0}
                onClick={() => onSelectPlan(p.id)}
                className={`cursor-pointer rounded-xl border p-4 transition ${
                  isHighlighted
                    ? "border-emerald-500 bg-slate-900 shadow-md ring-1 ring-emerald-500"
                    : "border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-slate-400">
                    {p.id}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      p.state === "Completed"
                        ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                        : p.state === "Review"
                        ? "bg-amber-950 text-amber-300 border border-amber-800"
                        : p.state === "Executing"
                        ? "bg-blue-950 text-blue-300 border border-blue-800"
                        : p.state === "Failed"
                        ? "bg-red-950 text-red-300 border border-red-800"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {p.state}
                  </span>
                </div>

                <h3 className="mt-2 text-sm font-semibold text-slate-100 line-clamp-2">
                  {p.title}
                </h3>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <span className="rounded bg-slate-800/80 px-2 py-0.5 font-medium text-slate-300">
                    {p.project}
                  </span>
                  {p.verifications && p.verifications.length > 0 && (
                    <div className="flex space-x-1">
                      {p.verifications.map((v) => (
                        <span
                          key={v.name}
                          title={`${v.name}: ${v.status}`}
                          className={`h-2 w-2 rounded-full ${
                            v.status === "Pass"
                              ? "bg-emerald-400"
                              : v.status === "Fail"
                              ? "bg-red-400"
                              : v.status === "Skipped"
                              ? "bg-slate-600"
                              : "bg-amber-400"
                          }`}
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
