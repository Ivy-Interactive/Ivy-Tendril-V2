import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  StackedProgress,
  type StackedProgressSegment,
} from "../src/components/ui/stacked-progress";

const phases: StackedProgressSegment[] = [
  { value: 3, label: "Passed", color: "success" },
  { value: 1, label: "Failed", color: "destructive" },
  { value: 6, label: "Queued", color: "muted" },
];

describe("StackedProgress component", () => {
  it("renders one progressbar per segment inside a labelled group", () => {
    render(<StackedProgress segments={phases} aria-label="Job phases" />);

    const group = screen.getByRole("group", { name: "Job phases" });
    expect(group).toBeDefined();

    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(group.contains(bar)).toBe(true);
    }
  });

  it("exposes min, max and per-segment values", () => {
    render(<StackedProgress segments={phases} aria-label="Job phases" />);

    const passed = screen.getByRole("progressbar", { name: "Passed" });
    expect(passed.getAttribute("aria-valuemin")).toBe("0");
    expect(passed.getAttribute("aria-valuemax")).toBe("10");
    expect(passed.getAttribute("aria-valuenow")).toBe("3");
    expect(passed.getAttribute("aria-valuetext")).toBe("Passed: 3 of 10");

    expect(screen.getByRole("progressbar", { name: "Queued" }).getAttribute("aria-valuenow")).toBe(
      "6",
    );
  });

  it("lets an explicit total override the computed sum", () => {
    render(<StackedProgress segments={phases} total={20} aria-label="Job phases" />);
    expect(screen.getByRole("progressbar", { name: "Passed" }).getAttribute("aria-valuemax")).toBe(
      "20",
    );
    expect(screen.getByRole("progressbar", { name: "Passed" }).getAttribute("aria-valuetext")).toBe(
      "Passed: 3 of 20",
    );
  });

  it("sizes segments proportionally", () => {
    render(<StackedProgress segments={phases} aria-label="Job phases" />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars[0].style.flex).toBe("30 1 0%");
    expect(bars[1].style.flex).toBe("10 1 0%");
    expect(bars[2].style.flex).toBe("60 1 0%");
  });

  it("renders an indeterminate segment without aria-valuenow", () => {
    render(
      <StackedProgress
        segments={[
          { value: 2, label: "Done", color: "success" },
          { value: 1, label: "Running", indeterminate: true },
        ]}
        aria-label="Job phases"
      />,
    );

    const running = screen.getByRole("progressbar", { name: "Running" });
    expect(running.getAttribute("aria-valuenow")).toBeNull();
    expect(running.getAttribute("aria-valuetext")).toBe("Indeterminate");
    expect(running.className).toContain("animate-indeterminate");
  });

  it("gives a zero-value indeterminate segment the remaining track", () => {
    render(
      <StackedProgress
        segments={[
          { value: 2, label: "Done", color: "success" },
          { value: 0, label: "Running", indeterminate: true },
        ]}
        aria-label="Job phases"
      />,
    );
    expect(screen.getByRole("progressbar", { name: "Running" }).style.flex).toBe("1 1 0%");
  });

  it("renders the empty track and no progressbars when the total is zero", () => {
    render(<StackedProgress segments={[{ value: 0, label: "Queued" }]} aria-label="Job phases" />);

    const group = screen.getByRole("group", { name: "Job phases" });
    expect(group.className).toContain("bg-muted");
    expect(group.style.height).toBe("8px");
    expect(group.style.borderRadius).toBe("4px");
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("renders an aria-hidden legend with labels and values", () => {
    render(<StackedProgress segments={phases} showLabels aria-label="Job phases" />);

    const legendEntry = screen.getByText("Passed");
    const legend = legendEntry.closest("[aria-hidden='true']");
    expect(legend).not.toBeNull();
    expect(legend?.textContent).toContain("Passed");
    expect(legend?.textContent).toContain("3");
    expect(legend?.textContent).toContain("Failed");
    expect(legend?.textContent).toContain("Queued");
  });

  it("announces the total in an sr-only summary", () => {
    const { container } = render(<StackedProgress segments={phases} aria-label="Job phases" />);
    expect(container.querySelector(".sr-only")?.textContent).toBe("Total: 10");
  });

  it("renders selectable segments as buttons and reports the clicked index", () => {
    const onSelect = vi.fn();
    render(<StackedProgress segments={phases} onSelect={onSelect} aria-label="Job phases" />);

    const failed = screen.getByRole("button", { name: "Select Failed" });
    fireEvent.click(failed);
    expect(onSelect).toHaveBeenCalledWith(1);

    // Enter comes free from using a real button.
    const queued = screen.getByRole("button", { name: "Select Queued" });
    fireEvent.keyDown(queued, { key: "Enter" });
    fireEvent.click(queued);
    expect(onSelect).toHaveBeenLastCalledWith(2);
  });

  it("applies the selection ring", () => {
    const { unmount } = render(
      <StackedProgress segments={phases} selected={1} aria-label="Job phases" />,
    );
    expect(screen.getByRole("progressbar", { name: "Failed" }).className).toContain(
      "ring-2 ring-foreground",
    );
    unmount();

    render(
      <StackedProgress
        segments={phases}
        selected={1}
        onSelect={() => {}}
        aria-label="Job phases"
      />,
    );
    expect(screen.getByRole("button", { name: "Select Failed" }).className).toContain(
      "ring-2 ring-foreground",
    );
  });

  it("maps the colour token union onto background classes", () => {
    render(<StackedProgress segments={phases} aria-label="Job phases" />);
    expect(screen.getByRole("progressbar", { name: "Passed" }).className).toContain("bg-success");
    expect(screen.getByRole("progressbar", { name: "Failed" }).className).toContain(
      "bg-destructive",
    );
    expect(screen.getByRole("progressbar", { name: "Queued" }).className).toContain(
      "bg-muted-foreground",
    );
  });

  it("merges a segment className as the escape hatch for a colour outside the union", () => {
    render(
      <StackedProgress
        segments={[{ value: 1, label: "Custom", className: "bg-[#abcdef]" }]}
        aria-label="Job phases"
      />,
    );
    expect(screen.getByRole("progressbar", { name: "Custom" }).className).toContain("bg-[#abcdef]");
  });
});
