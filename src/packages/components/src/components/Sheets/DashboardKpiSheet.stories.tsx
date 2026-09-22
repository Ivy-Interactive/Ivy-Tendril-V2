import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Button } from "../ui/button";
import { DashboardKpiSheet } from "./DashboardKpiSheet";
import type { BladeDescriptor } from "../ui/blades";

/**
 * The Dashboard's KPI drill-down — V1's `KpiBreakdownSheet`.
 *
 * Unlike `JobDebugSheet` this owns its own `<Sheet>`, so it needs no host: it opens when `blade`
 * stops being null. The stories give it a real button for that, because the thing worth looking at
 * is the blade filling the panel — the descriptor's own width hint is deliberately overridden to
 * `flex` when it is the root of this sheet, and that only shows once it is open.
 *
 * It used to be a hand-rolled `fixed inset-0` overlay with a literal `max-w-[72rem]`, which had no
 * responsive breakpoints and clipped a blade's content on anything narrower. The width ladder here
 * is the fix, so a narrow viewport is the case to check.
 */
function KpiTrigger({ blade, label }: { blade: BladeDescriptor; label: string }) {
  const [selected, setSelected] = React.useState<BladeDescriptor | null>(null);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setSelected(blade)} data-testid="kpi-story-trigger">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">
        Opens the drill-down the way a KPI tile does on the Dashboard.
      </p>
      <DashboardKpiSheet blade={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

const meta: Meta<typeof DashboardKpiSheet> = {
  title: "Sheets/DashboardKpiSheet",
  component: DashboardKpiSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof DashboardKpiSheet>;

/** A plain breakdown, the shape most KPI tiles open. */
export const CostBreakdown: Story = {
  render: () => (
    <KpiTrigger
      label="Spend this week"
      blade={
        {
          title: "Spend this week",
          body: (
            <div className="space-y-2 p-4 text-sm">
              <p className="text-muted-foreground">Cost by promptware, last 7 days.</p>
              <ul className="font-mono text-xs">
                <li>ExecutePlan — $18.42</li>
                <li>CreatePlan — $4.10</li>
                <li>RetryPlan — $2.87</li>
              </ul>
            </div>
          ),
        } as unknown as BladeDescriptor
      }
    />
  ),
};

/** A long body, which is what the panel's own scroller has to handle. */
export const LongBreakdown: Story = {
  render: () => (
    <KpiTrigger
      label="Jobs this month"
      blade={
        {
          title: "Jobs this month",
          body: (
            <div className="space-y-1 p-4 font-mono text-xs">
              {Array.from({ length: 60 }, (_, i) => (
                <div key={i}>
                  #{1100 + i} ExecutePlan — plan 00{380 + i} — Completed
                </div>
              ))}
            </div>
          ),
        } as unknown as BladeDescriptor
      }
    />
  ),
};

/** The empty case: a KPI with nothing behind it still has to say so rather than open blank. */
export const EmptyBreakdown: Story = {
  render: () => (
    <KpiTrigger
      label="Failed verifications"
      blade={
        {
          title: "Failed verifications",
          body: (
            <p className="p-4 text-sm text-muted-foreground">
              No verifications failed in this period.
            </p>
          ),
        } as unknown as BladeDescriptor
      }
    />
  ),
};
