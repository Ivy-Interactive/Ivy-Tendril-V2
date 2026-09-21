import type { Meta, StoryObj } from "@storybook/react";
import { AgentViewer } from "./AgentViewer.tsx";

const meta: Meta<typeof AgentViewer> = {
  title: "Components/AgentViewer",
  component: AgentViewer,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof AgentViewer>;

const mockSessionInit = JSON.stringify({
  kind: "session_init",
  timestamp: "2026-09-05T08:30:00Z",
  session_id: "sess_agent_storybook_001",
  model: "claude-3-7-sonnet",
  tools: ["view_file", "run_command", "write_to_file", "replace_file_content"],
});

const mockStreamingLines = [
  mockSessionInit,
  JSON.stringify({
    kind: "status",
    timestamp: "2026-09-05T08:30:00Z",
    message: "Verifying package configuration...",
  }),
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:01Z",
    text: "I will inspect the workspace and verify toolchain dependencies before proceeding.",
    delta: false,
  }),
  JSON.stringify({
    kind: "thinking",
    timestamp: "2026-09-05T08:30:02Z",
    content:
      "Checking whether `components-storybook` already has React 19 and `@storybook/react` installed. Need to inspect `package.json`.",
  }),
  JSON.stringify({
    kind: "status",
    timestamp: "2026-09-05T08:30:02Z",
    message: "Reading package.json dependencies...",
  }),
  JSON.stringify({
    kind: "tool_call",
    timestamp: "2026-09-05T08:30:03Z",
    tool_use_id: "call_view_pkg",
    tool_name: "view_file",
    description: "Viewing package.json",
    input: { AbsolutePath: "D:/git/SpaceCorps/components-storybook/package.json" },
  }),
  JSON.stringify({
    kind: "tool_result",
    timestamp: "2026-09-05T08:30:04Z",
    tool_use_id: "call_view_pkg",
    output:
      '{\n  "name": "components-storybook",\n  "dependencies": {\n    "react": "^19.2.3"\n  }\n}',
    is_error: false,
  }),
  JSON.stringify({
    kind: "tool_call",
    timestamp: "2026-09-05T08:30:05Z",
    tool_use_id: "call_run_test",
    tool_name: "run_command",
    description: "Running test suite",
    input: { CommandLine: "vp test --run" },
  }),
].join("\n");

const mockCompletedLines = [
  mockSessionInit,
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:01Z",
    text: "Starting execution of **Plan 00060: Port Tendril Agent and Execution Visualizers**.",
    delta: false,
  }),
  JSON.stringify({
    kind: "thinking",
    timestamp: "2026-09-05T08:30:02Z",
    content:
      "All source files found in Ivy.Tendril.Widgets. Beginning port into components-storybook.",
  }),
  JSON.stringify({
    kind: "status",
    timestamp: "2026-09-05T08:30:02Z",
    message: "Locating widget components...",
  }),
  JSON.stringify({
    kind: "tool_call",
    timestamp: "2026-09-05T08:30:03Z",
    tool_use_id: "call_view_source",
    tool_name: "view_file",
    description: "Viewing source AgentViewer.tsx",
    input: { AbsolutePath: "src/components/AgentViewer/AgentViewer.tsx" },
  }),
  JSON.stringify({
    kind: "tool_result",
    timestamp: "2026-09-05T08:30:04Z",
    tool_use_id: "call_view_source",
    output: "export const AgentViewer: React.FC<AgentViewerProps> = ...",
    is_error: false,
  }),
  JSON.stringify({
    kind: "tool_call",
    timestamp: "2026-09-05T08:30:05Z",
    tool_use_id: "call_lint",
    tool_name: "run_command",
    description: "Running vp check",
    input: { CommandLine: "vp check" },
  }),
  JSON.stringify({
    kind: "tool_result",
    timestamp: "2026-09-05T08:30:06Z",
    tool_use_id: "call_lint",
    output: "pass: Found no warnings, lint errors, or type errors in 35 files",
    is_error: false,
  }),
  JSON.stringify({
    kind: "tool_call",
    timestamp: "2026-09-05T08:30:07Z",
    tool_use_id: "call_vitest",
    tool_name: "run_command",
    description: "Running vitest unit tests",
    input: { CommandLine: "vp test --run" },
  }),
  JSON.stringify({
    kind: "tool_result",
    timestamp: "2026-09-05T08:30:08Z",
    tool_use_id: "call_vitest",
    output: "Test Files 7 passed (7)\nTests 29 passed (29)\nDuration 1.25s",
    is_error: false,
  }),
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:09Z",
    text: "### Summary of Implementation\n\nAll components and unit tests ported cleanly.\n\n- Ported `AgentViewer` with autoscroll and tool grouping\n- Ported `TendrilProcessViewer` with pipeline lifecycle stages\n- Exported public APIs from `src/index.ts`",
    delta: false,
  }),
  JSON.stringify({
    kind: "result",
    timestamp: "2026-09-05T08:30:10Z",
    is_success: true,
    duration_ms: 12450,
    turn_count: 4,
    exit_code: 0,
    usage: {
      input_tokens: 14200,
      output_tokens: 1650,
      cache_read_tokens: 8400,
      cache_write_tokens: 2100,
      reasoning_tokens: 520,
      cost_usd: 0.0485,
      premium_requests: 1,
    },
    response: "Execution completed successfully. All verifications passed.",
  }),
].join("\n");

const mockFailedLines = [
  mockSessionInit,
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:01Z",
    text: "Running build verification...",
    delta: false,
  }),
  JSON.stringify({
    kind: "tool_call",
    timestamp: "2026-09-05T08:30:02Z",
    tool_use_id: "call_build_fail",
    tool_name: "run_command",
    description: "Running vp pack",
    input: { CommandLine: "vp pack" },
  }),
  JSON.stringify({
    kind: "tool_result",
    timestamp: "2026-09-05T08:30:03Z",
    tool_use_id: "call_build_fail",
    output:
      "error TS2304: Cannot find name 'MissingType' at src/components/AgentViewer/AgentViewer.tsx:42:15",
    is_error: true,
  }),
  JSON.stringify({
    kind: "error",
    timestamp: "2026-09-05T08:30:04Z",
    message: "Build process failed with exit code 1. Unresolved TypeScript symbol.",
    is_retryable: true,
    is_auth_error: false,
  }),
  JSON.stringify({
    kind: "result",
    timestamp: "2026-09-05T08:30:05Z",
    is_success: false,
    duration_ms: 4500,
    exit_code: 1,
    usage: {
      input_tokens: 4200,
      output_tokens: 650,
      cost_usd: 0.0142,
    },
    response: "Verification failed. Fix compiler errors before attempting PR.",
  }),
].join("\n");

const mockLongLines = Array.from({ length: 8 })
  .flatMap((_, i) => [
    JSON.stringify({
      kind: "text",
      timestamp: "2026-09-05T08:30:00Z",
      text: `### Step ${i + 1}: Processing batch of tasks\n\nExamining file chunk and running verification ${i + 1}.`,
      delta: false,
    }),
    JSON.stringify({
      kind: "tool_call",
      timestamp: "2026-09-05T08:30:01Z",
      tool_use_id: `tool_call_${i}`,
      tool_name: "run_command",
      description: `Step ${i + 1} command`,
      input: { CommandLine: `echo "Processing batch ${i + 1}"` },
    }),
    JSON.stringify({
      kind: "tool_result",
      timestamp: "2026-09-05T08:30:02Z",
      tool_use_id: `tool_call_${i}`,
      output: `Batch ${i + 1} completed successfully with 0 errors.`,
      is_error: false,
    }),
  ])
  .concat([
    JSON.stringify({
      kind: "result",
      timestamp: "2026-09-05T08:30:30Z",
      is_success: true,
      duration_ms: 32000,
      usage: { cost_usd: 0.092, input_tokens: 35000, output_tokens: 4500 },
      response: "All 8 batches finished successfully.",
    }),
  ])
  .join("\n");

export const StreamingActive: Story = {
  args: {
    id: "agent-viewer-streaming",
    jsonStream: mockStreamingLines,
    autoScroll: true,
    showThinking: true,
    showSystemEvents: true,
    showStatusLabel: true,
    groupToolCalls: true,
    height: "px:500",
    eventHandler: () => {},
  },
  parameters: {
    // An incomplete run's metrics footer ticks its elapsed timer off Date.now() every second, which
    // no CSS freeze or settle delay can pin down.
    visual: { disable: true },
  },
};

export const CompletedSuccess: Story = {
  args: {
    id: "agent-viewer-completed",
    jsonStream: mockCompletedLines,
    autoScroll: true,
    showThinking: true,
    showSystemEvents: true,
    showStatusLabel: true,
    groupToolCalls: true,
    height: "px:600",
    eventHandler: () => {},
  },
};

export const FailedExecution: Story = {
  args: {
    id: "agent-viewer-failed",
    jsonStream: mockFailedLines,
    autoScroll: true,
    showThinking: true,
    showSystemEvents: true,
    showStatusLabel: true,
    groupToolCalls: true,
    height: "px:450",
    eventHandler: () => {},
  },
};

export const LongOutputWithAutoscroll: Story = {
  args: {
    id: "agent-viewer-long",
    jsonStream: mockLongLines,
    autoScroll: true,
    showThinking: false,
    showSystemEvents: false,
    showStatusLabel: true,
    groupToolCalls: true,
    height: "px:400",
    eventHandler: () => {},
  },
};

const mockRichPlanLogs = [
  mockSessionInit,
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:01Z",
    text: `## Workflow State Transitions

The following diagram shows how the plan moves through different states:

\`\`\`mermaid
graph LR
    Draft --> Creating
    Creating --> Executing
    Executing --> Review
    Executing --> Failed
    Review --> Completed
    Failed --> Draft
    Draft --> Blocked
    Blocked --> Draft
\`\`\`

The system ensures that each state transition is validated before proceeding.`,
    delta: false,
  }),
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:02Z",
    text: `## Architecture Overview

Here's the subsystem component structure:

\`\`\`graphviz
digraph G {
    rankdir=LR;
    node [shape=box, style=rounded];

    Frontend [label="Frontend\\n(React)"];
    API [label="API Gateway"];
    Worker [label="Worker\\nService"];
    DB [label="Database"];

    Frontend -> API [label="HTTP"];
    API -> Worker [label="Queue"];
    Worker -> DB [label="SQL"];
    API -> DB [label="Read"];
}
\`\`\`

This architecture allows for scalable background processing.`,
    delta: false,
  }),
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:03Z",
    text: `## Configuration Choice

Before proceeding, I need to confirm a detail:

\`\`\`questions
questions:
  - id: cache-strategy
    title: Which caching strategy should we use?
    description: |
      The system can use in-memory caching for speed or Redis for persistence.

      In-memory is faster but data is lost on restart.
      Redis persists data but adds network latency.
    options:
      - title: In-Memory
        description: Fast, but data is lost on restart
        value: in-memory
        recommended: true
      - title: Redis
        description: Persistent, but adds network latency
        value: redis
      - title: No Cache
        description: Simplest, but slowest
        value: none
\`\`\`

Please select your preferred caching strategy.`,
    delta: false,
  }),
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:04Z",
    text: `## Implementation

Here's a sample TypeScript implementation:

\`\`\`typescript
import { createCache } from "./cache";

interface Config {
  strategy: "in-memory" | "redis" | "none";
  ttl: number;
}

export function setupCache(config: Config) {
  return createCache({
    type: config.strategy,
    ttl: config.ttl,
  });
}
\`\`\`

This provides a flexible caching interface.`,
    delta: false,
  }),
  JSON.stringify({
    kind: "result",
    timestamp: "2026-09-05T08:30:05Z",
    is_success: true,
    duration_ms: 4200,
    usage: {
      input_tokens: 5200,
      output_tokens: 1150,
      cost_usd: 0.0285,
    },
    response: `## Final Summary

All diagrams and configuration options have been presented:

- ✅ Mermaid state transition diagram
- ✅ Graphviz architecture diagram
- ✅ Interactive question block for caching strategy
- ✅ Code example with syntax highlighting

The plan is ready for review.`,
  }),
].join("\n");

export const WithRichPlanLogs: Story = {
  args: {
    id: "agent-viewer-rich-logs",
    jsonStream: mockRichPlanLogs,
    events: ["OnAnswersChange"],
    autoScroll: true,
    showThinking: false,
    showSystemEvents: true,
    showStatusLabel: true,
    groupToolCalls: false,
    height: "px:700",
    eventHandler: (eventName, id, args) => {
      console.log(`Event: ${eventName}`, { id, args });
    },
  },
  parameters: {
    // These logs embed mermaid and graphviz fences, which resize the scroll container once their
    // lazily imported renderers finish. Auto-scroll then lands a few pixels off from run to run, so
    // there is no stable frame to screenshot.
    visual: { disable: true },
  },
};

/**
 * A run whose provider reported tokens but no charge, so Tendril priced it from the model's list rate.
 *
 * The point of the story is the pair of footers: this one and `CompletedSuccess`, which shows a cost the
 * agent actually billed. Same line, same layout, and the estimate is dimmer, italic and prefixed "~".
 */
const mockEstimatedCostLines = [
  mockSessionInit,
  JSON.stringify({
    kind: "text",
    timestamp: "2026-09-05T08:30:02Z",
    text: "Reviewed the four call sites and left the third one alone.",
    delta: false,
  }),
  JSON.stringify({
    kind: "result",
    timestamp: "2026-09-05T08:34:41Z",
    is_success: true,
    duration_ms: 281_000,
    usage: {
      input_tokens: 120,
      output_tokens: 4200,
      cache_read_tokens: 640_000,
      cache_write_tokens: 4459,
      reasoning_tokens: 0,
      cost_usd: 0.9412,
      cost_source: "estimated",
      model: "claude-3-7-sonnet",
    },
    response: "Reviewed the four call sites and left the third one alone.",
  }),
].join("\n");

export const EstimatedCost: Story = {
  args: {
    id: "agent-viewer-estimated-cost",
    jsonStream: mockEstimatedCostLines,
    autoScroll: false,
    showSystemEvents: true,
    height: "px:320",
    eventHandler: () => {},
  },
};
