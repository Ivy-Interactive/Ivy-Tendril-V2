import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModelCatalogCard } from "../src/components/ModelCatalogCard";
import { bridge } from "../src/api/bridge";
import type { ModelCatalogStatus } from "../src/types/api";

afterEach(() => {
  vi.restoreAllMocks();
});

function status(overrides: Partial<ModelCatalogStatus> = {}): ModelCatalogStatus {
  return {
    source: "models.dev",
    totalModelCount: 412,
    dynamicModelCount: 398,
    staticModelCount: 24,
    enrichModels: true,
    cachedAt: new Date().toISOString(),
    cachePath: "/Users/x/.tendril/cache/models_cache.json",
    ...overrides,
  };
}

describe("ModelCatalogCard", () => {
  it("renders the live badge, model count, and a fresh relative age with no stale marker", async () => {
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status());

    render(<ModelCatalogCard />);

    await waitFor(() => expect(screen.getByText("Live (models.dev)")).toBeInTheDocument());
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("398 enriched / 24 curated")).toBeInTheDocument();
    expect(screen.getByText("Just now")).toBeInTheDocument();
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
  });

  it("renders the static fallback badge and never-cached copy", async () => {
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(
      status({ source: "static", cachedAt: null }),
    );

    render(<ModelCatalogCard />);

    await waitFor(() => expect(screen.getByText("Static fallback")).toBeInTheDocument());
    expect(screen.getByText("Never (no cache file)")).toBeInTheDocument();
  });

  it("marks a cache older than 24 hours as stale", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status({ cachedAt: threeDaysAgo }));

    render(<ModelCatalogCard />);

    await waitFor(() => expect(screen.getByText(/Stale/)).toBeInTheDocument());
  });

  it("refreshes the catalog on click, disabling the button while pending", async () => {
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status());
    const refreshModels = vi
      .spyOn(bridge, "refreshModels")
      .mockResolvedValue(status({ dynamicModelCount: 400, totalModelCount: 414 }));

    render(<ModelCatalogCard />);
    await waitFor(() => expect(screen.getByText("Live (models.dev)")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Refresh Now" }));
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();

    await waitFor(() =>
      expect(screen.getByText("Refreshed: 400 models from models.dev")).toBeInTheDocument(),
    );
    expect(refreshModels).toHaveBeenCalledOnce();
    expect(screen.getByText("414")).toBeInTheDocument();
  });

  it("shows the error message and keeps the previous status visible when refresh fails", async () => {
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status());
    vi.spyOn(bridge, "refreshModels").mockRejectedValue(
      new Error("Failed to refresh models (503): models.dev unreachable"),
    );

    render(<ModelCatalogCard />);
    await waitFor(() => expect(screen.getByText("Live (models.dev)")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Refresh Now" }));

    await waitFor(() =>
      expect(
        screen.getByText("Failed to refresh models (503): models.dev unreachable"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Live (models.dev)")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
  });

  it("renders an error row instead of crashing when the initial load fails", async () => {
    vi.spyOn(bridge, "getModelsStatus").mockRejectedValue(new Error("daemon unreachable"));

    render(<ModelCatalogCard />);

    await waitFor(() => expect(screen.getByTestId("model-catalog-error")).toBeInTheDocument());
    expect(screen.getByText("daemon unreachable")).toBeInTheDocument();
  });
});
