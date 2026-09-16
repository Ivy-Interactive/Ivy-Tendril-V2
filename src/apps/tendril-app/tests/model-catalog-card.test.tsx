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

  /**
   * The threshold is `modelCacheWarnAgeDays`, not a hardcoded 24 hours: the daemon's default is 7
   * days (`DEFAULT_CACHE_WARN_AGE_DAYS`), and the card used to report "Stale" on a cache the daemon
   * was still happy with.
   */
  it("marks a cache older than the configured warn age as stale", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status({ cachedAt: tenDaysAgo }));
    vi.spyOn(bridge, "getConfig").mockRejectedValue(new Error("offline"));

    render(<ModelCatalogCard />);

    await waitFor(() => expect(screen.getByText(/Stale/)).toBeInTheDocument());
  });

  it("leaves a cache inside the configured warn age unmarked", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status({ cachedAt: threeDaysAgo }));
    vi.spyOn(bridge, "getConfig").mockRejectedValue(new Error("offline"));

    render(<ModelCatalogCard />);

    await waitFor(() => expect(screen.getByText("3 days ago")).toBeInTheDocument());
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
  });

  it("honours a config that shortens the warn age", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status({ cachedAt: threeDaysAgo }));
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: { modelCacheWarnAgeDays: 1 } });

    render(<ModelCatalogCard />);

    await waitFor(() => expect(screen.getByText(/Stale/)).toBeInTheDocument());
  });

  it("never marks a cache stale when the warn tier is disabled with 0", async () => {
    const yearAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status({ cachedAt: yearAgo }));
    vi.spyOn(bridge, "getConfig").mockResolvedValue({
      raw: { modelCacheWarnAgeDays: 0, modelCacheMaxAgeDays: 0 },
    });

    render(<ModelCatalogCard />);

    await waitFor(() => expect(screen.getByText(/400 days ago/)).toBeInTheDocument());
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Expired/)).not.toBeInTheDocument();
  });

  /**
   * `enrichModels` and the three cache-age keys are all read by the daemon. They used to be
   * reportable but not settable, which is the same as the feature being absent.
   */
  it("writes only the changed enrichment keys and re-reads config and status", async () => {
    const getModelsStatus = vi
      .spyOn(bridge, "getModelsStatus")
      .mockResolvedValue(status({ enrichModels: false }));
    const getConfig = vi
      .spyOn(bridge, "getConfig")
      .mockResolvedValue({ raw: { enrichModels: false } });
    const putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);

    render(<ModelCatalogCard />);
    await waitFor(() =>
      expect(screen.getByLabelText("Enrich the catalog from models.dev")).not.toBeChecked(),
    );

    fireEvent.click(screen.getByLabelText("Enrich the catalog from models.dev"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith("enrichModels", true));
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(getModelsStatus).toHaveBeenCalledTimes(2);
  });

  it("refuses an out-of-range cache age with the bounded-int message and writes nothing", async () => {
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status());
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: {} });
    const putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);

    render(<ModelCatalogCard />);
    await waitFor(() => expect(screen.getByLabelText("Cache Warn Age")).toHaveValue(7));

    fireEvent.change(screen.getByLabelText("Cache Warn Age"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByTestId("model-catalog-save-error")).toHaveTextContent(
        "modelCacheWarnAgeDays must be between 0 and 365, got 900.",
      ),
    );
    expect(putConfig).not.toHaveBeenCalled();
  });

  it("keeps Save disabled until an enrichment field changes", async () => {
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue(status());
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ raw: {} });

    render(<ModelCatalogCard />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());

    fireEvent.change(screen.getByLabelText("Refresh Interval"), { target: { value: "6" } });

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
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
