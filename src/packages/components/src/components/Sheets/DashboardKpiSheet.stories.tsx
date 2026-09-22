import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { DataTable, type DataTableColumn } from "../ui/data-table";
import { DetailItem, Details } from "../ui/detail";
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
 *
 * The blades below carry their body in `content`, the field `Blade` renders. They used to pass
 * `body` through an `as unknown as BladeDescriptor` cast, so every story opened an empty panel and
 * none of them could show whether a breakdown fits the sheet — which is the one question a story of
 * this sheet has to answer.
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
      blade={{
        title: "Spend this week",
        content: (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Cost by promptware, last 7 days.</p>
            <ul className="font-mono text-xs">
              <li>ExecutePlan — $18.42</li>
              <li>CreatePlan — $4.10</li>
              <li>RetryPlan — $2.87</li>
            </ul>
          </div>
        ),
      }}
    />
  ),
};

/** A long body, which is what the panel's own scroller has to handle. */
export const LongBreakdown: Story = {
  render: () => (
    <KpiTrigger
      label="Jobs this month"
      blade={{
        title: "Jobs this month",
        content: (
          <div className="space-y-1 font-mono text-xs">
            {Array.from({ length: 60 }, (_, i) => (
              <div key={i}>
                #{1100 + i} ExecutePlan — plan 00{380 + i} — Completed
              </div>
            ))}
          </div>
        ),
      }}
    />
  ),
};

/** The empty case: a KPI with nothing behind it still has to say so rather than open blank. */
export const EmptyBreakdown: Story = {
  render: () => (
    <KpiTrigger
      label="Failed verifications"
      blade={{
        title: "Failed verifications",
        content: (
          <p className="text-sm text-muted-foreground">No verifications failed in this period.</p>
        ),
      }}
    />
  ),
};

interface FeatureDay {
  date: string;
  count: number;
}

interface MergedPr {
  planId: number;
  title: string;
  repo: string;
  updated: string;
  prUrl: string;
}

const featureDays: FeatureDay[] = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-09-${String(30 - i).padStart(2, "0")}`,
  count: (i * 7) % 5,
}));

const mergedPrs: MergedPr[] = Array.from({ length: 12 }, (_, i) => ({
  planId: 1180 + i,
  title: `Move the Dashboard KPI breakdown onto the shared sheet primitive, part ${i + 1}`,
  repo: "/Users/operator/git/ivy-interactive/Ivy-Tendril-V2",
  updated: `2026-09-${String(22 - i).padStart(2, "0")} 14:${String(10 + i).padStart(2, "0")}:00`,
  prUrl: `https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/${400 + i}`,
}));

const featureDayColumns: DataTableColumn<FeatureDay>[] = [
  { name: "date", header: "Date", width: "140px", accessor: (r) => r.date },
  { name: "count", header: "Features", align: "Right", accessor: (r) => r.count },
];

/** `KpiBreakdown.tsx`'s `mergedPrColumns`, which is where the widths and the wrapping come from. */
const mergedPrColumns: DataTableColumn<MergedPr>[] = [
  { name: "planId", header: "Plan", width: "80px", accessor: (r) => r.planId },
  { name: "title", header: "Title", accessor: (r) => r.title, wrapText: true },
  { name: "repo", header: "Repo", accessor: (r) => r.repo, wrapText: true },
  { name: "updated", header: "Merged", width: "170px", accessor: (r) => r.updated },
  {
    name: "prUrl",
    header: "PR URL",
    width: "60px",
    sortable: false,
    accessor: (r) => r.prUrl,
    cell: (value) => (
      <a href={String(value)} target="_blank" rel="noreferrer" className="text-xs underline">
        open
      </a>
    ),
  },
];

const KpiSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="border-t border-border">
    <h4 className="px-4 pt-4 text-sm font-semibold text-foreground">{title}</h4>
    {children}
  </section>
);

/**
 * The Features Shipped panel, composed the way the app's `KpiBreakdown.tsx` composes it: a callout
 * whose one sentence is longer than the sheet is wide, a label/value list whose values are pinned
 * right, a paginated table, and a table holding a repo path with no spaces to break on.
 *
 * Every one of those asks its container how wide it would like to be, and this is the story that
 * showed the sheet answering with the content's width instead of its own: the callout ran off the
 * left edge, the labels went with it, and the sheet grew a horizontal scrollbar. Open it at a narrow
 * viewport too — a table that genuinely cannot fit scrolls inside its own frame, and nothing else
 * moves.
 */
export const FeaturesShipped: Story = {
  render: () => (
    <KpiTrigger
      label="Features Shipped"
      blade={{
        title: "Features Shipped",
        subtitle: "Merged PRs and solved issues behind the count",
        content: [
          <Callout.Info key="note" title="Output Metric" className="m-4">
            Features Shipped counts merged PRs and solved issues without a PR over the last 30 days.
            A plan with three PRs counts three features; an issue-only plan counts one.
          </Callout.Info>,
          <Details key="details" className="px-4 pb-4">
            <DetailItem label="Metric">Features Shipped</DetailItem>
            <DetailItem label="Formula">Merged PRs + solved issues, last 30 days</DetailItem>
            <DetailItem label="Last 30 Days">58</DetailItem>
            <DetailItem label="Prior 30 Days">41</DetailItem>
            <DetailItem label="30-Day Period Delta">+41%</DetailItem>
          </Details>,
          <KpiSection key="days" title="Features by Day (Last 30 Days)">
            <DataTable
              columns={featureDayColumns}
              rows={featureDays}
              getRowId={(row) => row.date}
              defaultPageSize={25}
            />
          </KpiSection>,
          <KpiSection key="prs" title="Recent Merged Pull Requests">
            <DataTable
              columns={mergedPrColumns}
              rows={mergedPrs}
              getRowId={(row) => row.prUrl}
              defaultPageSize={25}
            />
          </KpiSection>,
        ],
      }}
    />
  ),
};
