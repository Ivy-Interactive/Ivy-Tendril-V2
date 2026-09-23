import * as React from "react";
import {
  ImportRepoAssetsDialog as ImportRepoAssetsDialogView,
  type DiscoveredRepoAsset,
  type RepoAssetKind,
} from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";

export interface ImportRepoAssetsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  kind: RepoAssetKind;
  /** The project's configured repo paths. */
  projectRepos: string[];
  /** Called with what was imported, once the daemon has written `config.yaml`. */
  onImported: (names: string[]) => void;
}

/**
 * The connected half of the library's `ImportRepoAssetsDialog` (V1
 * `Apps/Settings/Dialogs/ImportRepoAssetsDialog.cs`): `POST /api/projects/:name/repo-assets/scan`
 * behind the dialog's scan, and `/import` behind *Import Selected*. The daemon writes the project's
 * `skills` / `mcpServers` itself (and copies each skill's folder under `Projects/<p>/Skills/`), so
 * the caller only has to re-read the config afterwards.
 *
 * Scans are sequenced like `AgentTestDialog`'s runs: a reply to a scan the operator has since
 * replaced (picked another repo, typed another URL) is dropped rather than shown for the wrong source.
 */
export function ImportRepoAssetsDialog({
  isOpen,
  onClose,
  projectName,
  kind,
  projectRepos,
  onImported,
}: ImportRepoAssetsDialogProps) {
  const [items, setItems] = React.useState<DiscoveredRepoAsset[] | null>(null);
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scanId = React.useRef(0);

  React.useEffect(() => {
    if (!isOpen) {
      scanId.current += 1;
      setItems(null);
      setScanError(null);
      setError(null);
      setIsScanning(false);
      setIsImporting(false);
    }
  }, [isOpen]);

  const scan = (source: string) => {
    const thisScan = ++scanId.current;
    setIsScanning(true);
    setScanError(null);
    setError(null);
    bridge
      .scanRepoAssets(projectName, kind, source)
      .then((found) => {
        if (scanId.current === thisScan) setItems(found);
      })
      .catch((err: unknown) => {
        if (scanId.current !== thisScan) return;
        setItems(null);
        setScanError(describeBridgeError(err));
      })
      .finally(() => {
        if (scanId.current === thisScan) setIsScanning(false);
      });
  };

  return (
    <ImportRepoAssetsDialogView
      isOpen={isOpen}
      onClose={onClose}
      kind={kind}
      projectRepos={projectRepos}
      onScan={scan}
      items={items}
      isScanning={isScanning}
      scanError={scanError}
      isImporting={isImporting}
      error={error}
      onImport={async ({ source, names }) => {
        setIsImporting(true);
        setError(null);
        try {
          const imported = await bridge.importRepoAssets(projectName, kind, source, names);
          onImported(imported);
          onClose();
        } catch (err) {
          setError(describeBridgeError(err));
        } finally {
          setIsImporting(false);
        }
      }}
    />
  );
}
