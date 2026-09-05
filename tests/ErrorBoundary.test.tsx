import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

const Thrower = () => {
  throw new Error("Intentional Render Error");
};

describe("ErrorBoundary", () => {
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it("catches errors in children and renders ErrorDisplay fallback", () => {
    const { container } = render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("Intentional Render Error");
    expect(container.querySelector("button")?.textContent).toContain("Copy Details");
  });

  it("renders children normally when no error occurs", () => {
    const { container } = render(
      <ErrorBoundary>
        <div>Working Content</div>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain("Working Content");
  });
});
