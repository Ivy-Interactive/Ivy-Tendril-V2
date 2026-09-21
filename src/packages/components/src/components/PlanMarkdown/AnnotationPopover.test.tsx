import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import type { SelectionToolbar as SelectionToolbarType } from "./AnnotationPopover";

const withUserAgent = async (userAgent: string) => {
  vi.stubGlobal("navigator", { userAgent, platform: "" });
  vi.resetModules();
  const mod = await import("./AnnotationPopover");
  return mod.SelectionToolbar;
};

describe("SelectionToolbar add-comment shortcut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const renderToolbar = (SelectionToolbar: typeof SelectionToolbarType) =>
    render(<SelectionToolbar position={{ top: 0, left: 0 }} onAddComment={() => {}} />);

  it("shows the Mac chord on a Mac user agent", async () => {
    const SelectionToolbar = await withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    renderToolbar(SelectionToolbar);
    expect(screen.getByText("⌘⌥M")).toBeInTheDocument();
  });

  it("shows the Ctrl+Alt chord everywhere else", async () => {
    const SelectionToolbar = await withUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    renderToolbar(SelectionToolbar);
    expect(screen.getByText("Ctrl+Alt+M")).toBeInTheDocument();
  });
});
