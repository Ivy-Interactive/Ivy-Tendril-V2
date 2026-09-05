import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToolUseGroup } from "./tool-use-group.tsx";
import type { ToolUsePresentation } from "./types.ts";

afterEach(() => {
  cleanup();
});

describe("ToolUseGroup", () => {
  it("renders collapsed by default", () => {
    const tools: ToolUsePresentation[] = [
      { toolUseId: "1", name: "Read", input: { file_path: "test.ts" }, result: "OK" },
      { toolUseId: "2", name: "Write", input: { file_path: "out.ts" }, result: "OK" },
      { toolUseId: "3", name: "Bash", input: { command: "echo test" }, result: "OUT" },
    ];

    render(<ToolUseGroup tools={tools} />);

    expect(screen.getByText("3 tool calls")).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("Write")).not.toBeInTheDocument();
    expect(screen.queryByText("OUT")).not.toBeInTheDocument();

    const header = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking the header reveals individual tool cards", () => {
    const tools: ToolUsePresentation[] = [
      { toolUseId: "1", name: "Read", input: { file_path: "test.ts" }, result: "OK" },
      { toolUseId: "2", name: "Write", input: { file_path: "out.ts" }, result: "OK" },
      { toolUseId: "3", name: "Bash", input: { command: "echo test" }, result: "OUT" },
    ];

    render(<ToolUseGroup tools={tools} />);

    const header = screen.getByRole("button");
    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Write")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();

    expect(screen.queryByText("OUT")).not.toBeInTheDocument();
  });
});
