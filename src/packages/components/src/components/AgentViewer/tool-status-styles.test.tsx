import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToolUseCard } from "./tool-use-card.tsx";

afterEach(() => {
  cleanup();
});

describe("ToolUseCard status styles", () => {
  it("renders success status with correct class", () => {
    const tool = {
      name: "Read",
      input: { file_path: "test.ts" },
      result: "OK",
    };

    const { container } = render(<ToolUseCard tool={tool} />);
    const statusDot = container.querySelector(".aov-tool-status--success");

    expect(statusDot).toBeInTheDocument();
    expect(statusDot).toHaveClass("aov-tool-status");
    expect(statusDot).toHaveClass("aov-tool-status--success");
  });

  it("renders error status with correct class", () => {
    const tool = {
      name: "Write",
      input: { file_path: "test.ts" },
      result: "Error: File not found",
      isError: true,
    };

    const { container } = render(<ToolUseCard tool={tool} />);
    const statusDot = container.querySelector(".aov-tool-status--error");

    expect(statusDot).toBeInTheDocument();
    expect(statusDot).toHaveClass("aov-tool-status");
    expect(statusDot).toHaveClass("aov-tool-status--error");
  });

  it("renders running status with correct class", () => {
    const tool = {
      name: "Bash",
      input: { command: "npm test" },
    };

    const { container } = render(<ToolUseCard tool={tool} />);
    const statusDot = container.querySelector(".aov-tool-status--running");

    expect(statusDot).toBeInTheDocument();
    expect(statusDot).toHaveClass("aov-tool-status");
    expect(statusDot).toHaveClass("aov-tool-status--running");
  });
});
