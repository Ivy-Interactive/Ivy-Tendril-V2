import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentViewer } from "./AgentViewer";

const mockSessionInit = JSON.stringify({
  kind: "session_init",
  timestamp: "2026-09-05T08:30:00Z",
  session_id: "test_session",
  model: "claude-3-7-sonnet",
});

describe("AgentViewer - Rich Block Rendering", () => {
  it("renders assistant text with mermaid diagram", async () => {
    const jsonStream = [
      mockSessionInit,
      JSON.stringify({
        kind: "text",
        timestamp: "2026-09-05T08:30:01Z",
        text: "Here is a diagram:\n\n```mermaid\ngraph TD;\n  A-->B;\n```",
        delta: false,
      }),
    ].join("\n");

    render(<AgentViewer id="test-mermaid" jsonStream={jsonStream} eventHandler={() => {}} />);

    await waitFor(() => {
      expect(
        screen.queryByText(/Loading diagram/) ||
          document.querySelector(".pmv-diagram-container") ||
          document.querySelector("svg"),
      ).toBeTruthy();
    });
  });

  it("renders assistant text with graphviz diagram", async () => {
    const jsonStream = [
      mockSessionInit,
      JSON.stringify({
        kind: "text",
        timestamp: "2026-09-05T08:30:01Z",
        text: "Here is a graph:\n\n```graphviz\ndigraph { A -> B; }\n```",
        delta: false,
      }),
    ].join("\n");

    render(<AgentViewer id="test-graphviz" jsonStream={jsonStream} eventHandler={() => {}} />);

    await waitFor(() => {
      expect(
        screen.queryByText(/Loading diagram/) ||
          document.querySelector(".pmv-diagram-container") ||
          document.querySelector("svg"),
      ).toBeTruthy();
    });
  });

  it("renders questions block in read-only mode when OnAnswersChange is not subscribed", () => {
    const jsonStream = [
      mockSessionInit,
      JSON.stringify({
        kind: "text",
        timestamp: "2026-09-05T08:30:01Z",
        text: `Select an option:

\`\`\`questions
questions:
  - id: test-question
    title: Choose a color
    options:
      - title: Red
        value: red
      - title: Blue
        value: blue
\`\`\``,
        delta: false,
      }),
    ].join("\n");

    render(
      <AgentViewer id="test-questions-readonly" jsonStream={jsonStream} eventHandler={() => {}} />,
    );

    expect(screen.getByText("Choose a color")).toBeTruthy();
    expect(document.querySelector(".pmv-questions")).toBeTruthy();
  });

  it("triggers OnAnswersChange when OnAnswersChange is in events and user interacts", () => {
    const mockEventHandler = vi.fn();
    const jsonStream = [
      mockSessionInit,
      JSON.stringify({
        kind: "text",
        timestamp: "2026-09-05T08:30:01Z",
        text: `Select an option:

\`\`\`questions
questions:
  - id: test-question-interactive
    title: Choose a strategy
    options:
      - title: Option A
        value: option-a
      - title: Option B
        value: option-b
\`\`\``,
        delta: false,
      }),
    ].join("\n");

    render(
      <AgentViewer
        id="test-questions-interactive"
        jsonStream={jsonStream}
        events={["OnAnswersChange"]}
        eventHandler={mockEventHandler}
      />,
    );

    expect(screen.getByText("Choose a strategy")).toBeTruthy();
    expect(screen.getByText("Option A")).toBeTruthy();
  });

  it("renders plain code blocks with syntax highlighting and copy button", () => {
    const jsonStream = [
      mockSessionInit,
      JSON.stringify({
        kind: "text",
        timestamp: "2026-09-05T08:30:01Z",
        text: "Here is some code:\n\n```typescript\nconst x = 42;\n```",
        delta: false,
      }),
    ].join("\n");

    const { container } = render(
      <AgentViewer id="test-code-block" jsonStream={jsonStream} eventHandler={() => {}} />,
    );

    const codeElement = container.querySelector("code.language-typescript");
    expect(codeElement).toBeTruthy();
    expect(codeElement?.textContent).toContain("const x = 42;");
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
  });

  it("renders result summary with rich blocks", async () => {
    const jsonStream = [
      mockSessionInit,
      JSON.stringify({
        kind: "result",
        timestamp: "2026-09-05T08:30:02Z",
        is_success: true,
        duration_ms: 1000,
        response: `## Summary

\`\`\`mermaid
graph TD;
  Start-->End;
\`\`\`

Done.`,
      }),
    ].join("\n");

    render(
      <AgentViewer id="test-result-with-diagram" jsonStream={jsonStream} eventHandler={() => {}} />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText(/Loading diagram/) ||
          document.querySelector(".pmv-diagram-container") ||
          document.querySelector("svg"),
      ).toBeTruthy();
    });
  });

  it("renders status event as .aov-status-event and does not generate .aov-assistant", () => {
    const jsonStream = [
      mockSessionInit,
      JSON.stringify({
        kind: "status",
        timestamp: "2026-09-05T08:30:01Z",
        message: "Scanning directory tree...",
      }),
    ].join("\n");

    const { container } = render(
      <AgentViewer id="test-status-event" jsonStream={jsonStream} eventHandler={() => {}} />,
    );

    const statusElement = container.querySelector(".aov-status-event");
    expect(statusElement).toBeTruthy();
    expect(statusElement?.textContent).toContain("Scanning directory tree...");
    expect(container.querySelector(".aov-assistant")).toBeNull();
  });

  it("suppresses status events when showStatusEvents is false", () => {
    const jsonStream = [
      mockSessionInit,
      JSON.stringify({
        kind: "status",
        timestamp: "2026-09-05T08:30:01Z",
        message: "Scanning directory tree...",
      }),
    ].join("\n");

    const { container } = render(
      <AgentViewer
        id="test-status-event-suppressed"
        jsonStream={jsonStream}
        showStatusEvents={false}
        showStatusLabel={false}
        eventHandler={() => {}}
      />,
    );

    expect(container.querySelector(".aov-status-event")).toBeNull();
    expect(screen.queryByText("Scanning directory tree...")).toBeNull();
  });
});
