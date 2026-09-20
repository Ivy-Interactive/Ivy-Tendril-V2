import React, { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Switch,
} from "@ivy-interactive/components/ui";
import { bridge } from "../api/bridge";
import { describeBridgeError, type ModelCatalogStatus, type TendrilConfig } from "../types/api";
import { SettingsSection } from "../views/settings/fields";

/**
 * The cache is called stale once it is older than `modelCacheWarnAgeDays`, which is the same
 * threshold `model_cache` warns on daemon-side. `0` or negative disables the tier ("never warn"),
 * so a non-positive value means nothing is ever marked stale.
 */
const DEFAULT_WARN_AGE_DAYS = 7;
const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_ENRICHMENT_INTERVAL_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatRelativeAge(cachedAt: string | null, now: number = Date.now()): string {
  if (cachedAt === null) return "Never (no cache file)";

  const cachedAtMs = new Date(cachedAt).getTime();
  const diffMs = Math.max(0, now - cachedAtMs);
  const minutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(diffMs / DAY_MS);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Whether the disk cache has crossed `warnAgeDays`. The threshold is a parameter rather than a
 * constant because it is a config key the daemon honours (`modelCacheWarnAgeDays`), and a card that
 * hardcoded 24h reported "Stale" on a cache the daemon was perfectly happy with.
 */
export function isStale(
  cachedAt: string | null,
  warnAgeDays: number = DEFAULT_WARN_AGE_DAYS,
  now: number = Date.now(),
): boolean {
  if (cachedAt === null) return false;
  if (warnAgeDays <= 0) return false;
  const cachedAtMs = new Date(cachedAt).getTime();
  return now - cachedAtMs > warnAgeDays * DAY_MS;
}

/** Past this age the cache is ignored entirely and the static `SPECS` table is used instead. */
export function isExpired(
  cachedAt: string | null,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
  now: number = Date.now(),
): boolean {
  if (cachedAt === null) return false;
  if (maxAgeDays <= 0) return false;
  const cachedAtMs = new Date(cachedAt).getTime();
  return now - cachedAtMs > maxAgeDays * DAY_MS;
}

/**
 * The enrichment keys `TendrilSettings` models. All four are honoured by the daemon and none of them
 * were reachable from this card before: `enrichModels` was rendered as read-only text, and the three
 * numbers were only settable with `tendril config set`.
 */
interface EnrichmentForm {
  enrichModels: boolean;
  modelEnrichmentIntervalHours: number;
  modelCacheWarnAgeDays: number;
  modelCacheMaxAgeDays: number;
}

const ENRICHMENT_DEFAULTS: EnrichmentForm = {
  enrichModels: true,
  modelEnrichmentIntervalHours: DEFAULT_ENRICHMENT_INTERVAL_HOURS,
  modelCacheWarnAgeDays: DEFAULT_WARN_AGE_DAYS,
  modelCacheMaxAgeDays: DEFAULT_MAX_AGE_DAYS,
};

/** `0` and negative values are meaningful for all three numbers, so only the upper bound is a limit. */
const ENRICHMENT_BOUNDS: Record<keyof Omit<EnrichmentForm, "enrichModels">, [number, number]> = {
  modelEnrichmentIntervalHours: [0, 8760],
  modelCacheWarnAgeDays: [0, 365],
  modelCacheMaxAgeDays: [0, 365],
};

const numberOf = (raw: unknown, fallback: number): number =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;

/** None of these four are on `TendrilConfigDto`, so they come out of the untouched `raw` config. */
export function enrichmentFormOf(cfg: TendrilConfig | null): EnrichmentForm {
  const raw = cfg?.raw ?? {};
  return {
    enrichModels:
      typeof raw.enrichModels === "boolean" ? raw.enrichModels : ENRICHMENT_DEFAULTS.enrichModels,
    modelEnrichmentIntervalHours: numberOf(
      raw.modelEnrichmentIntervalHours,
      ENRICHMENT_DEFAULTS.modelEnrichmentIntervalHours,
    ),
    modelCacheWarnAgeDays: numberOf(
      raw.modelCacheWarnAgeDays,
      ENRICHMENT_DEFAULTS.modelCacheWarnAgeDays,
    ),
    modelCacheMaxAgeDays: numberOf(
      raw.modelCacheMaxAgeDays,
      ENRICHMENT_DEFAULTS.modelCacheMaxAgeDays,
    ),
  };
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right">{children}</dd>
  </div>
);

export const ModelCatalogCard: React.FC = () => {
  const [status, setStatus] = useState<ModelCatalogStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [saved, setSaved] = useState<EnrichmentForm>(ENRICHMENT_DEFAULTS);
  const [form, setForm] = useState<EnrichmentForm>(ENRICHMENT_DEFAULTS);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const applyConfig = (cfg: TendrilConfig | null) => {
    const next = enrichmentFormOf(cfg);
    setSaved(next);
    setForm(next);
  };

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
    // The enrichment settings are a nice-to-have on this card, so a config read that fails leaves
    // the defaults in place rather than replacing the whole card with an error.
    void bridge
      .getConfig()
      .then(applyConfig)
      .catch(() => {});
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

  /**
   * Only changed keys are written, so a save cannot clobber a concurrent edit to config.yaml, and
   * the config plus the status are both re-read afterwards: turning `enrichModels` off changes what
   * the status reports, so an optimistic local update would disagree with the daemon.
   */
  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      for (const key of Object.keys(form) as (keyof EnrichmentForm)[]) {
        if (form[key] === saved[key]) continue;
        if (key !== "enrichModels") {
          const [min, max] = ENRICHMENT_BOUNDS[key];
          const value = form[key];
          if (!Number.isInteger(value) || value < min || value > max) {
            setSaveError(`${key} must be between ${min} and ${max}, got ${value}.`);
            return;
          }
        }
        await bridge.putConfig(key, form[key]);
      }
      applyConfig(await bridge.getConfig());
      setStatus(await bridge.getModelsStatus());
    } catch (err) {
      setSaveError(`Failed to save: ${describeBridgeError(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const set = <K extends keyof EnrichmentForm>(key: K, value: EnrichmentForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const stale = isStale(status?.cachedAt ?? null, saved.modelCacheWarnAgeDays);
  const expired = isExpired(status?.cachedAt ?? null, saved.modelCacheMaxAgeDays);
  const hasChanges = (Object.keys(form) as (keyof EnrichmentForm)[]).some(
    (key) => form[key] !== saved[key],
  );

  return (
    // Heading, hint and header action were hand-rolled here in exactly the markup
    // `SettingsSection` already draws, so this section kept its box when that one lost it.
    //
    // Collapsed by default: the catalogue is a diagnostic readout plus three tuning knobs, and it
    // sits directly under Coding Agent - the row the operator actually came for. V1 has no
    // equivalent screen at all, so the closest thing to its layout is for this not to occupy the
    // page until asked for.
    <SettingsSection
      title="Model Catalog"
      hint="Tendril merges the curated model table with a models.dev snapshot cached on disk."
      testId="model-catalog-card"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isRefreshing}
          onClick={handleRefresh}
        >
          {isRefreshing ? "Refreshing…" : "Refresh Now"}
        </Button>
      }
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className="group flex w-full items-center gap-2 rounded-box py-1 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          data-testid="model-catalog-toggle"
        >
          <ChevronDown
            className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden
          />
          {isOpen ? "Hide catalog status and settings" : "Show catalog status and settings"}
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          {loadError && (
            <p data-testid="model-catalog-error" className="mt-3 text-xs text-destructive">
              {loadError}
            </p>
          )}

          {refreshMessage && !refreshError && (
            <p className="mt-3 font-mono text-xs text-success">{refreshMessage}</p>
          )}

          {refreshError && <p className="mt-3 text-xs text-destructive">{refreshError}</p>}

          {status && (
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Source:">
                {status.source === "models.dev" ? (
                  <Badge
                    variant="secondary"
                    title="Catalog is enriched from models.dev"
                    aria-label="Live (models.dev)"
                  >
                    Live (models.dev)
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    title="Catalog is using the static fallback table"
                    aria-label="Static fallback"
                  >
                    Static fallback
                  </Badge>
                )}
              </Row>

              <Row label="Models:">
                <div className="text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground">{status.totalModelCount}</div>
                  <div>
                    {status.dynamicModelCount} enriched / {status.staticModelCount} curated
                  </div>
                </div>
              </Row>

              <Row label="Cache updated:">
                <span
                  className={`text-xs ${stale ? "text-warning" : "text-muted-foreground"}`}
                  title={status.cachedAt ?? undefined}
                >
                  {formatRelativeAge(status.cachedAt)}
                  {stale && " (Stale)"}
                  {expired && " (Expired, using curated table)"}
                </span>
              </Row>

              <Row label="Cache file:">
                <span
                  className="max-w-50 truncate font-mono text-xs text-muted-foreground"
                  title={status.cachePath}
                >
                  {status.cachePath}
                </span>
              </Row>
            </dl>
          )}

          {/* Every one of these is a key the daemon reads. They used to be reportable but not settable,
          which is the same as the feature being absent from the app. */}
          {/* `noValidate`: the `min`/`max` attributes still drive the spinner, but the refusal the
          operator reads is `ParseBoundedInt`'s message rather than a browser bubble. */}
          <form
            noValidate
            className="mt-6 max-w-120 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <div className="flex items-center gap-3">
              <Switch
                id="enrich-models-switch"
                aria-labelledby="enrich-models-label"
                checked={form.enrichModels}
                onCheckedChange={(checked) => set("enrichModels", checked)}
              />
              <Label
                id="enrich-models-label"
                htmlFor="enrich-models-switch"
                className="text-xs font-medium text-foreground"
              >
                Enrich the catalog from models.dev
              </Label>
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="model-enrichment-interval-input"
                className="text-xs font-medium text-muted-foreground"
              >
                Refresh Interval
              </Label>
              <Input
                id="model-enrichment-interval-input"
                type="number"
                min={ENRICHMENT_BOUNDS.modelEnrichmentIntervalHours[0]}
                max={ENRICHMENT_BOUNDS.modelEnrichmentIntervalHours[1]}
                value={form.modelEnrichmentIntervalHours}
                disabled={!form.enrichModels}
                onChange={(e) =>
                  set("modelEnrichmentIntervalHours", Number.parseInt(e.target.value, 10) || 0)
                }
              />
              <p className="text-xs text-muted-foreground">
                Hours between background refreshes. 0 refreshes once at startup and never again.
              </p>
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="model-cache-warn-age-input"
                className="text-xs font-medium text-muted-foreground"
              >
                Cache Warn Age
              </Label>
              <Input
                id="model-cache-warn-age-input"
                type="number"
                min={ENRICHMENT_BOUNDS.modelCacheWarnAgeDays[0]}
                max={ENRICHMENT_BOUNDS.modelCacheWarnAgeDays[1]}
                value={form.modelCacheWarnAgeDays}
                onChange={(e) =>
                  set("modelCacheWarnAgeDays", Number.parseInt(e.target.value, 10) || 0)
                }
              />
              <p className="text-xs text-muted-foreground">
                Days after which the cache is still used but reported as stale. 0 never warns.
              </p>
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="model-cache-max-age-input"
                className="text-xs font-medium text-muted-foreground"
              >
                Cache Max Age
              </Label>
              <Input
                id="model-cache-max-age-input"
                type="number"
                min={ENRICHMENT_BOUNDS.modelCacheMaxAgeDays[0]}
                max={ENRICHMENT_BOUNDS.modelCacheMaxAgeDays[1]}
                value={form.modelCacheMaxAgeDays}
                onChange={(e) =>
                  set("modelCacheMaxAgeDays", Number.parseInt(e.target.value, 10) || 0)
                }
              />
              <p className="text-xs text-muted-foreground">
                Days after which the cache is ignored and the curated table is used instead. 0 never
                expires.
              </p>
            </div>

            {saveError && (
              <p className="text-xs text-destructive" data-testid="model-catalog-save-error">
                {saveError}
              </p>
            )}

            <Button type="submit" disabled={!hasChanges || isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </form>
        </CollapsibleContent>
      </Collapsible>
    </SettingsSection>
  );
};
