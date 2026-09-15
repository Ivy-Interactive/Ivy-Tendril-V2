import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  BadgeSelect,
  useFocusManagement,
  useFocusable,
  useShortcut,
  type BadgeSelectOption,
} from "@ivy-interactive/components/tendril";
import type { PlanSummary } from "../types/api";
import { EmptyState } from "../components/EmptyState";

const PLANS_FOCUS_GROUP = "plans-list";

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

/**
 * One plan row. Registering with the focus group by index is what lets the arrow keys move real DOM
 * focus rather than only the highlight — the row is already `tabIndex={0}` with focus-visible styling.
 */
const PlanRow: React.FC<{
  index: number;
  highlighted: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}> = ({ index, highlighted, onSelect, children }) => {
  const { ref } = useFocusable(PLANS_FOCUS_GROUP, index);
  return (
    <div
      ref={ref}
      role="listitem"
      tabIndex={0}
      onClick={onSelect}
      className={`cursor-pointer rounded-xl border p-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
        highlighted
          ? "border-ring bg-card shadow-md ring-1 ring-ring"
          : "border-border bg-card/60 hover:border-ring hover:bg-card"
      }`}
    >
      {children}
    </div>
  );
};

export const PlansView: React.FC<PlansViewProps> = ({ plans, onSelectPlan, onNewPlan }) => {
  const [search, setSearch] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowFocus = useFocusManagement(PLANS_FOCUS_GROUP);

  // `skipInInputs` subsumes the activeElement guard this used to need: a "/" typed into the search
  // box is a slash, not a shortcut.
  useShortcut("plans:focus-search", "/", () => searchInputRef.current?.focus(), {
    description: "Focus search bar in plans explorer",
  });

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

  // Arrow key navigation. This stays on its own listener — it drives a selection index, not a single
  // discoverable action — but the arrows now move DOM focus alongside the highlight, so a screen
  // reader and the focus ring follow the selection instead of staying on whatever was last clicked.
  useEffect(() => {
    const handleNavigation = (e: KeyboardEvent) => {
      if (filteredPlans.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredPlans.length);
        rowFocus.focusNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? filteredPlans.length - 1 : prev - 1));
        rowFocus.focusPrevious();
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
  }, [filteredPlans, selectedIndex, onSelectPlan, rowFocus]);

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
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground"
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
              eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
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
              className="flex items-center space-x-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
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
              <PlanRow
                key={p.id}
                index={idx}
                highlighted={isHighlighted}
                onSelect={() => onSelectPlan(p.id)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {p.id}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      p.state === "Completed"
                        ? "bg-success/10 text-success border border-success/40"
                        : p.state === "Review"
                          ? "bg-warning/10 text-warning border border-warning/40"
                          : p.state === "Executing"
                            ? "bg-info/10 text-info border border-info/40"
                            : p.state === "Failed"
                              ? "bg-destructive/10 text-destructive border border-destructive/40"
                              : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {p.state}
                  </span>
                </div>

                <h3 className="mt-2 text-sm font-semibold text-foreground line-clamp-2">
                  {p.title}
                </h3>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="rounded bg-muted/80 px-2 py-0.5 font-medium text-muted-foreground">
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
                              ? "bg-success"
                              : v.status === "Fail"
                                ? "bg-destructive"
                                : v.status === "Skipped"
                                  ? "bg-muted-foreground"
                                  : "bg-warning"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </PlanRow>
            );
          })}
        </div>
      )}
    </div>
  );
};
