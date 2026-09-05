import { useState } from "react";
import { PlanMarkdown } from "./PlanMarkdown";

export default {
  title: "Components/PlanMarkdown",
  component: PlanMarkdown,
};

const SAMPLE_MARKDOWN = `# Plan 00062: Port Plan Inspection Widgets

## Problem

The component library requires rich specification rendering capabilities including:
- Formatted markdown with GitHub alerts
- Math formulas via KaTeX
- Technical diagrams via Mermaid and Graphviz
- Interactive questions blocks

> [!NOTE]
> This is a GitHub-style note callout for informational context.

> [!WARNING]
> This is a warning callout highlighting critical architectural considerations.

## Solution

### Code Implementation

Here is an example C# service implementation:

\`\`\`csharp
public class PlanService : IPlanService
{
    private readonly ILogger<PlanService> _logger;

    public PlanService(ILogger<PlanService> logger)
    {
        _logger = logger;
    }

    public async Task<PlanResult> ExecuteAsync(string planId, CancellationToken ct)
    {
        _logger.LogInformation("Executing plan {PlanId}", planId);
        return new PlanResult { Success = true };
    }
}
\`\`\`

### Mathematical Formula

The computational complexity is governed by:
$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$

And the energy equivalence: $$E = mc^2$$.

### Interactive Questions

\`\`\`questions
questions:
  - id: execution-mode
    title: Which execution profile should be applied?
    options:
      - title: Balanced
        value: balanced
        recommended: true
      - title: Deep Reasoning
        value: deep
  - id: notification-channels
    title: Select notification channels
    multiple: true
    options:
      - title: Slack
        value: slack
      - title: Email
        value: email
      - title: Webhook
        value: webhook
\`\`\`

### Diagrams

#### Mermaid Workflow

\`\`\`mermaid
graph TD
  A[Intake] --> B[CreatePlan]
  B --> C{Approved?}
  C -->|Yes| D[ExecutePlan]
  C -->|No| E[UpdatePlan]
  D --> F[Verification]
  F --> G[Completed]
\`\`\`

#### Graphviz Flowchart

\`\`\`graphviz
digraph Pipeline {
  rankdir=LR;
  node [shape=box, style=rounded];
  Intake -> Plan -> Worktree -> Verification -> PR;
}
\`\`\`
`;

export const Default = {
  render: () => {
    const [content] = useState(SAMPLE_MARKDOWN);

    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem" }}>
        <PlanMarkdown id="default-story" content={content} />
      </div>
    );
  },
};

export const AlertsAndMath = {
  render: () => (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "1.5rem" }}>
      <PlanMarkdown
        id="alerts-math-story"
        content={`
> [!NOTE]
> Informational notice.

> [!TIP]
> Pro-tip for optimal performance.

> [!IMPORTANT]
> Important prerequisite.

> [!WARNING]
> Warning: do not mutate state directly.

> [!CAUTION]
> Caution: destructive operation.

$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$
        `}
      />
    </div>
  ),
};

export const InteractiveQuestions = {
  render: () => {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "1.5rem" }}>
        <PlanMarkdown
          id="interactive-questions-story"
          content={`
\`\`\`questions
questions:
  - id: cache-backend
    title: Which cache backend should we configure?
    options:
      - title: In-Memory Cache
        value: memory
        recommended: true
      - title: Redis Cache
        value: redis
\`\`\`
          `}
        />
      </div>
    );
  },
};
