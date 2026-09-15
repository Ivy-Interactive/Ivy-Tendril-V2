import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "@/components/ui/badge";
import { VirtualList } from "@/components/ui/virtual-list";
import { Densities } from "@/types/density";

const meta: Meta = {
  title: "UI/VirtualList",
};

export default meta;

interface LogEntry {
  id: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}

const levels: LogEntry["level"][] = ["info", "warn", "error"];
const sources = ["scheduler", "worktree", "agent", "promptware", "server"];

/**
 * Message length varies with the index, so rows have genuinely different heights and the story
 * exercises `measureElement` rather than a fixed-height fast path.
 */
const entries: LogEntry[] = Array.from({ length: 1000 }, (_, index) => ({
  id: `log-${index + 1}`,
  level: levels[index % levels.length],
  source: sources[index % sources.length],
  message: `Job ${index + 1} ${"reconciled its worktree and flushed the queue. ".repeat(
    1 + (index % 4),
  )}`,
}));

const levelVariant: Record<LogEntry["level"], "secondary" | "warning" | "destructive"> = {
  info: "secondary",
  warn: "warning",
  error: "destructive",
};

const renderEntry = (entry: LogEntry) => (
  <div className="flex gap-3 border-b px-3 py-2">
    <Badge variant={levelVariant[entry.level]}>{entry.level}</Badge>
    <div className="min-w-0">
      <p className="text-sm font-medium">{entry.source}</p>
      <p className="text-sm text-muted-foreground">{entry.message}</p>
    </div>
  </div>
);

/**
 * 1,000 variable-height rows in a bounded container. Only the visible slice plus overscan is in the
 * DOM; the scrollbar still reports the full height.
 */
export const VariableHeight: StoryObj = {
  render: () => (
    <div className="h-[480px] w-[700px] rounded-md border">
      <VirtualList
        items={entries}
        getItemKey={(entry) => entry.id}
        renderItem={renderEntry}
        aria-label="Job log"
      />
    </div>
  ),
};

/** The density estimate only affects first paint, before a row has been measured. */
export const DensityEstimates: StoryObj = {
  render: () => (
    <div className="flex gap-4">
      {[Densities.Small, Densities.Medium, Densities.Large].map((density) => (
        <div key={density} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{density}</p>
          <div className="h-[320px] w-[320px] rounded-md border">
            <VirtualList
              items={entries}
              density={density}
              getItemKey={(entry) => entry.id}
              renderItem={(entry) => (
                <div className="border-b px-3 py-2 text-sm">
                  {entry.source}: {entry.message}
                </div>
              )}
              aria-label={`Job log (${density})`}
            />
          </div>
        </div>
      ))}
    </div>
  ),
};

/**
 * `pinnedIndex` keeps one row mounted no matter where the viewport is — the guarantee a focused row
 * or a streaming tail needs. Scroll away from the top and item 0 stays in the DOM.
 */
export const PinnedItem: StoryObj = {
  render: () => (
    <div className="h-[400px] w-[700px] rounded-md border">
      <VirtualList
        items={entries}
        pinnedIndex={0}
        getItemKey={(entry) => entry.id}
        renderItem={renderEntry}
        aria-label="Job log with a pinned first row"
      />
    </div>
  ),
};
