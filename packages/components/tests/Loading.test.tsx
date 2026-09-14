import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Loading, Spinner, SkeletonList } from "../src/components/Loading";

describe("Loading component", () => {
  it("renders Spinner variant with role status and Loader2", () => {
    const { container } = render(<Loading type="Spinner" />);
    const status = screen.getByRole("status");
    expect(status).toBeDefined();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(status.textContent).toContain("Loading...");
  });

  it("renders Skeleton variant with multiple skeleton bars", () => {
    const { container } = render(<Loading type="Skeleton" />);
    const status = screen.getByRole("status");
    expect(status).toBeDefined();
    const skeletons = container.querySelectorAll(".bg-muted");
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
  });

  it("renders standalone Spinner and SkeletonList subcomponents", () => {
    const { container: spinnerContainer } = render(<Spinner text="Custom..." />);
    expect(spinnerContainer.textContent).toContain("Custom...");

    const { container: skeletonContainer } = render(<SkeletonList />);
    expect(skeletonContainer.querySelector('[role="status"]')).not.toBeNull();
  });
});
