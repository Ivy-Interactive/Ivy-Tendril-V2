import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanMarkdown } from "../src/components/PlanMarkdown/PlanMarkdown.tsx";

describe("Tauri Safe Link Navigation in PlanMarkdown", () => {
  let originalWindowOpen: typeof window.open;

  beforeEach(() => {
    originalWindowOpen = window.open;
    window.open = vi.fn();
  });

  afterEach(() => {
    window.open = originalWindowOpen;
    vi.restoreAllMocks();
  });

  it("calls onLinkClick callback and prevents default navigation for external links", () => {
    const onLinkClick = vi.fn();
    render(
      React.createElement(PlanMarkdown, {
        id: "plan-test",
        content: "[External Site](https://example.com/docs)",
        onLinkClick,
      }),
    );

    const link = screen.getByRole("link", { name: "External Site" });
    fireEvent.click(link);

    expect(onLinkClick).toHaveBeenCalledTimes(1);
    expect(onLinkClick).toHaveBeenCalledWith("https://example.com/docs", expect.anything());
    expect(window.open).not.toHaveBeenCalled();
  });

  it("safely opens external links in a new window when no onLinkClick handler is supplied", () => {
    render(
      React.createElement(PlanMarkdown, {
        id: "plan-test",
        content: "[External Site](https://example.com/portal)",
      }),
    );

    const link = screen.getByRole("link", { name: "External Site" });
    fireEvent.click(link);

    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/portal",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("calls onFileClick callback and prevents default navigation for local file links", () => {
    const onFileClick = vi.fn();
    render(
      React.createElement(PlanMarkdown, {
        id: "plan-test",
        content: "[Local Config](file:///Users/dev/project/config.yaml)",
        onFileClick,
      }),
    );

    const link = screen.getByRole("link", { name: "Local Config" });
    fireEvent.click(link);

    expect(onFileClick).toHaveBeenCalledTimes(1);
    expect(onFileClick).toHaveBeenCalledWith(
      "file:///Users/dev/project/config.yaml",
      expect.anything(),
    );
    expect(window.open).not.toHaveBeenCalled();
  });

  it("renders non-navigating text elements for local files when dangerouslyAllowLocalFiles is false and no onFileClick provided", () => {
    const { container } = render(
      React.createElement(PlanMarkdown, {
        id: "plan-test",
        content: "[Local Script](file:///Users/dev/project/run.sh)",
      }),
    );

    expect(screen.queryByRole("link", { name: "Local Script" })).toBeNull();
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("Local Script");
  });

  it("does not invoke window.open for in-page hash anchors", () => {
    render(
      React.createElement(PlanMarkdown, {
        id: "plan-test",
        content: "[Jump To Section](#section-two)",
      }),
    );

    const link = screen.getByRole("link", { name: "Jump To Section" });
    fireEvent.click(link);

    expect(window.open).not.toHaveBeenCalled();
  });

  it("supports legacy Ivy OnLinkClick eventHandler for external links", () => {
    const eventHandler = vi.fn();
    render(
      React.createElement(PlanMarkdown, {
        id: "plan-test",
        content: "[Ivy Action](https://example.com/ivy)",
        events: ["OnLinkClick"],
        eventHandler,
      }),
    );

    const link = screen.getByRole("link", { name: "Ivy Action" });
    fireEvent.click(link);

    expect(eventHandler).toHaveBeenCalledWith("OnLinkClick", "plan-test", [
      "https://example.com/ivy",
    ]);
    expect(window.open).not.toHaveBeenCalled();
  });
});
