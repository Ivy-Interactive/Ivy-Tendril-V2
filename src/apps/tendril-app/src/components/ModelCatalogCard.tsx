import React, { useState, useEffect } from "react";
import { bridge } from "../api/bridge";
import type { ModelCatalogStatus } from "../types/api";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function formatRelativeAge(cachedAt: string | null, now: number = Date.now()): string {
  if (cachedAt === null) return "Never (no cache file)";

  const cachedAtMs = new Date(cachedAt).getTime();
  const diffMs = Math.max(0, now - cachedAtMs);
  const minutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function isStale(cachedAt: string | null, now: number = Date.now()): boolean {
  if (cachedAt === null) return false;
  const cachedAtMs = new Date(cachedAt).getTime();
  return now - cachedAtMs > STALE_THRESHOLD_MS;
}

export const ModelCatalogCard: React.FC = () => {
  const [status, setStatus] = useState<ModelCatalogStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStatus() {
      try {
        const result = await bridge.getModelsStatus();
        setStatus(result);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadStatus();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const result = await bridge.refreshModels();
      setStatus(result);
      setLoadError(null);
      setRefreshMessage(`Refreshed: ${result.dynamicModelCount} models from models.dev`);
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  };

  const stale = status ? isStale(status.cachedAt) : false;

  return (
    <div
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-6"
      data-testid="model-catalog-card"
    >
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <h2 className="text-base font-semibold text-slate-100">Model Catalog</h2>
        <button
          type="button"
          disabled={isRefreshing}
          onClick={handleRefresh}
          className="rounded-lg bg-emerald-600/80 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
        >
          {isRefreshing ? "Refreshing…" : "Refresh Now"}
        </button>
      </div>

      {loadError && (
        <div
          data-testid="model-catalog-error"
          className="mt-3 rounded bg-slate-950 p-2 text-xs text-red-400"
        >
          {loadError}
        </div>
      )}

      {refreshMessage && !refreshError && (
        <div className="mt-3 rounded bg-slate-950 p-2 font-mono text-xs text-emerald-400">
          {refreshMessage}
        </div>
      )}

      {refreshError && (
        <div className="mt-3 rounded bg-slate-950 p-2 text-xs text-red-400">{refreshError}</div>
      )}

      {status && (
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-400">Source:</dt>
            <dd>
              {status.source === "models.dev" ? (
                <span
                  title="Catalog is enriched from models.dev"
                  aria-label="Live (models.dev)"
                  className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs font-semibold text-emerald-400"
                >
                  Live (models.dev)
                </span>
              ) : (
                <span
                  title="Catalog is using the static fallback table"
                  aria-label="Static fallback"
                  className="rounded bg-amber-900/40 px-2 py-0.5 text-xs font-semibold text-amber-400"
                >
                  Static fallback
                </span>
              )}
            </dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-slate-400">Models:</dt>
            <dd className="text-right text-xs text-slate-300">
              <div className="font-semibold text-slate-200">{status.totalModelCount}</div>
              <div>
                {status.dynamicModelCount} enriched / {status.staticModelCount} curated
              </div>
            </dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-slate-400">Cache updated:</dt>
            <dd
              className={`text-xs ${stale ? "text-amber-400" : "text-slate-300"}`}
              title={status.cachedAt ?? undefined}
            >
              {formatRelativeAge(status.cachedAt)}
              {stale && " (Stale)"}
            </dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-slate-400">Auto-enrichment:</dt>
            <dd className="text-xs text-slate-300">
              {status.enrichModels ? "Enabled" : "Disabled (enrichModels: false)"}
            </dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-slate-400">Cache file:</dt>
            <dd
              className="font-mono text-xs text-slate-300 truncate max-w-[200px]"
              title={status.cachePath}
            >
              {status.cachePath}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
};
