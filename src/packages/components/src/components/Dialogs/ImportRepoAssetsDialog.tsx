import * as React from "react";
import { Search } from "lucide-react";
import { useTranslation } from "@/i18n/uiSettings";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { NativeSelect } from "../ui/native-select";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { AssetChecklist } from "../Vault/AssetChecklist";
import { DialogShell } from "./DialogShell";

/** `enum ImportAssetKind { McpServers, Skills }`. */
export type RepoAssetKind = "skills" | "mcpServers";

/** One discovered item: V1's `DiscoveredItemRowView(name, badgeText, description)`. */
export interface DiscoveredRepoAsset {
  name: string;
  /** Where it was found, relative to the repo root (a `SKILL.md` folder, an MCP config file). */
  sourcePath: string;
  /** A skill's description, or an MCP server's command line. */
  detail: string;
}

/** The three `sourceMode` values; "repo" only exists when the project has repos. */
export type RepoAssetSourceMode = "repo" | "gitUrl" | "localPath";

export interface ImportRepoAssetsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  kind: RepoAssetKind;
  /** The project's configured repo paths, for the *Project Repo* source. */
  projectRepos: string[];
  /**
   * Scan a source: a configured repo path, a git URL or a local folder. The host resolves it (a URL
   * is cloned first) and answers through {@link items} / {@link scanError}.
   */
  onScan: (source: string) => void;
  /** What the last scan found; `null` before anything has been scanned. */
  items: DiscoveredRepoAsset[] | null;
  isScanning?: boolean;
  scanError?: string | null;
  /** Import the ticked items from the source that produced {@link items}. */
  onImport: (request: { source: string; names: string[] }) => void;
  isImporting?: boolean;
  /** A failed import, shown in the dialog so the selection survives. */
  error?: string | null;
}

/** The last path segment, which is how V1 labels a project repo (`Path.GetFileName(r.Path)`). */
function repoLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || path;
}

/**
 * `Apps/Settings/Dialogs/ImportRepoAssetsDialog.cs`: pick a repository — one of the project's own,
 * a git URL, or a local folder — scan it for custom skills (`SKILL.md`) or MCP server configs, tick
 * the ones to keep, and import them into the project.
 *
 * **Presentational.** Resolving and scanning the source, and the import itself, are the host's
 * (`POST /api/projects/:name/repo-assets/scan` and `/import` in the app). The dialog keeps what is
 * on screen: the source picker, and the selection — every discovered item ticked, as V1 seeds it.
 *
 * A project repo is scanned as soon as it is picked, as V1's `UseEffect` does; a URL or a folder is
 * scanned on its button, since a half-typed URL is not worth cloning. The checklist is the vault's
 * `AssetChecklist`, which already carries the bulk Select/Deselect All V1 puts beside the heading.
 */
export function ImportRepoAssetsDialog({
  isOpen,
  onClose,
  kind,
  projectRepos,
  onScan,
  items,
  isScanning = false,
  scanError,
  onImport,
  isImporting = false,
  error,
}: ImportRepoAssetsDialogProps) {
  const { t } = useTranslation("uiSettings");
  const hasRepos = projectRepos.length > 0;
  const [mode, setMode] = React.useState<RepoAssetSourceMode>(hasRepos ? "repo" : "gitUrl");
  const [selectedRepo, setSelectedRepo] = React.useState(projectRepos[0] ?? "");
  const [gitUrl, setGitUrl] = React.useState("");
  const [localPath, setLocalPath] = React.useState("");
  const [scannedSource, setScannedSource] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);

  const onScanRef = React.useRef(onScan);
  onScanRef.current = onScan;

  const scan = React.useCallback((source: string) => {
    setScannedSource(source.trim());
    onScanRef.current(source.trim());
  }, []);

  // Everything found starts ticked (`selectedItemNames.Set(new HashSet(servers.Select(s => s.Name)))`).
  React.useEffect(() => {
    setSelected(items ? items.map((item) => item.name) : []);
  }, [items]);

  // Auto-scan on open and whenever the picked project repo changes.
  React.useEffect(() => {
    if (isOpen && mode === "repo" && selectedRepo.trim() !== "") scan(selectedRepo);
  }, [isOpen, mode, selectedRepo, scan]);

  const modes: RepoAssetSourceMode[] = hasRepos
    ? ["repo", "gitUrl", "localPath"]
    : ["gitUrl", "localPath"];
  const canImport =
    selected.length > 0 && !isScanning && !isImporting && scannedSource !== null && items !== null;
  const byName = new Map((items ?? []).map((item) => [item.name, item]));

  const sourceField = (
    id: string,
    label: string,
    value: string,
    placeholder: string,
    setValue: (next: string) => void,
    scanLabel: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          className="flex-1"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim() !== "") {
              event.preventDefault();
              scan(value);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={isScanning || value.trim() === ""}
          onClick={() => scan(value)}
          data-testid="import-repo-assets-scan"
        >
          {isScanning ? <Spinner size="sm" /> : <Search className="size-4" aria-hidden />}
          {scanLabel}
        </Button>
      </div>
    </div>
  );

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("importRepoAssets.title", { context: kind })}
      testId="import-repo-assets-dialog"
      width="rem36"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("importRepoAssets.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canImport}
            data-testid="import-repo-assets-submit"
            onClick={() => {
              if (canImport && scannedSource !== null)
                onImport({ source: scannedSource, names: selected });
            }}
          >
            {isImporting ? <Spinner size="sm" /> : null}
            {t("importRepoAssets.submit", { count: selected.length })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-foreground">
            {t("importRepoAssets.source.heading")}
          </p>
          {/* `sourceMode.ToSelectInput(...).Variant(SelectInputVariant.Toggle)`. */}
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("importRepoAssets.source.heading")}
          >
            {modes.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={mode === value ? "default" : "outline"}
                aria-pressed={mode === value}
                data-testid={`import-repo-assets-mode-${value}`}
                onClick={() => setMode(value)}
              >
                {t(`importRepoAssets.source.modes.${value}`)}
              </Button>
            ))}
          </div>
        </div>

        {mode === "repo" && (
          <div className="space-y-1.5">
            <Label htmlFor="import-repo-assets-repo">{t("importRepoAssets.source.repo")}</Label>
            <NativeSelect
              id="import-repo-assets-repo"
              value={selectedRepo}
              onChange={(event) => setSelectedRepo(event.target.value)}
            >
              {projectRepos.map((path) => (
                <option key={path} value={path} title={path}>
                  {repoLabel(path)}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {mode === "gitUrl" &&
          sourceField(
            "import-repo-assets-url",
            t("importRepoAssets.source.gitUrl"),
            gitUrl,
            "https://github.com/owner/repo.git",
            setGitUrl,
            t("importRepoAssets.fetchAndScan"),
          )}
        {mode === "localPath" &&
          sourceField(
            "import-repo-assets-path",
            t("importRepoAssets.source.localPath"),
            localPath,
            t("importRepoAssets.source.localPathPlaceholder"),
            setLocalPath,
            t("importRepoAssets.scan"),
          )}

        <Separator />

        <div data-testid="import-repo-assets-results" aria-live="polite">
          {isScanning ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              {t("importRepoAssets.scanning")}
            </p>
          ) : scanError ? (
            <Callout.Warning data-testid="import-repo-assets-scan-error">
              {scanError}
            </Callout.Warning>
          ) : items === null ? (
            <p className="text-xs text-muted-foreground">{t("importRepoAssets.notScanned")}</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="import-repo-assets-empty">
              {t("importRepoAssets.empty", { context: kind })}
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <AssetChecklist
                label={t("importRepoAssets.discovered", { context: kind })}
                category={kind}
                items={items.map((item) => item.name)}
                selected={selected}
                onChange={setSelected}
                emptyText=""
                defaultOpen
                describeItem={(name) => {
                  const item = byName.get(name);
                  return { badge: item?.sourcePath, detail: item?.detail };
                }}
              />
            </div>
          )}
        </div>

        {error && <Callout.Error data-testid="import-repo-assets-error">{error}</Callout.Error>}
      </div>
    </DialogShell>
  );
}
