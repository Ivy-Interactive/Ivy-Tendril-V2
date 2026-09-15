import React from "react";
import {
  CircleArrowUp,
  Download,
  GitMerge,
  GitPullRequest,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { IconButton } from "../ui/IconButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { GatedActionButton } from "./GatedActionButton";
import type { VaultGate } from "./gate";
import type { VaultCatalogItem, VaultItemSyncStatus } from "./types";

export interface VaultProjectsTableProps {
  items: VaultCatalogItem[];
  onImport: (item: VaultCatalogItem) => void;
  /** *Link & Merge* — resolve a name conflict by merging into the existing local project. */
  onMerge: (item: VaultCatalogItem) => void;
  onUpdate: (item: VaultCatalogItem) => void;
  /** *Publish* / *Open PR* — both open the push dialog with this project preselected. */
  onPublish: (item: VaultCatalogItem) => void;
  onDelete: (item: VaultCatalogItem) => void;
  onAddTrackedProject: () => void;
  isLoading?: boolean;
  gate?: VaultGate;
}

const OPEN: VaultGate = { disabled: false };

const SYNC_STATUS_LABELS: Record<VaultItemSyncStatus, string> = {
  UpToDate: "✓ In Sync",
  Modified: "Local Changes",
  UpdateAvailable: "Update Available",
  LocalOnly: "Local Only",
  NotImported: "Not Imported",
  Conflict: "Name Conflict",
};

const SYNC_STATUS_VARIANTS: Record<VaultItemSyncStatus, "secondary" | "outline" | "destructive"> = {
  UpToDate: "secondary",
  Modified: "outline",
  UpdateAvailable: "destructive",
  LocalOnly: "outline",
  NotImported: "outline",
  Conflict: "destructive",
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The content badges, each shown only when the project actually carries that kind of asset. */
function contentBadges(item: VaultCatalogItem): string[] {
  const badges: string[] = [];
  if (item.reposCount > 0) badges.push(plural(item.reposCount, "repo", "repos"));
  if (item.skillsCount > 0) badges.push(plural(item.skillsCount, "skill", "skills"));
  if (item.mcpsCount > 0) badges.push(`${item.mcpsCount} MCPs`);
  if (item.memoriesCount > 0) badges.push(plural(item.memoriesCount, "memory", "memories"));
  if (item.reviewActionsCount > 0)
    badges.push(plural(item.reviewActionsCount, "action", "actions"));
  if (item.verificationsCount > 0) badges.push(plural(item.verificationsCount, "verif", "verifs"));
  return badges;
}

function versionLabel(item: VaultCatalogItem): string {
  if (item.remoteVersion) return `v${item.remoteVersion}`;
  if (item.localVersion) return `v${item.localVersion}`;
  return "-";
}

export const VaultProjectsTable: React.FC<VaultProjectsTableProps> = ({
  items,
  onImport,
  onMerge,
  onUpdate,
  onPublish,
  onDelete,
  onAddTrackedProject,
  isLoading = false,
  gate = OPEN,
}) => {
  const addTrackedProject = (
    <GatedActionButton gate={gate} variant="outline" size="sm" onClick={onAddTrackedProject}>
      <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
      Add Tracked Project
    </GatedActionButton>
  );

  if (isLoading && items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="vault-projects-loading">
        Loading shared projects...
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-2" data-testid="vault-projects-empty">
        <p className="text-sm font-semibold text-foreground">No Shared Projects</p>
        <p className="text-xs text-muted-foreground">
          This vault does not contain any shared projects yet. Add a local project to share it with
          your team.
        </p>
        <div className="flex">{addTrackedProject}</div>
      </div>
    );
  }

  /* The changelog column earns its width only when some row has something to put in it. */
  const showChangelog = items.some((item) => item.latestChangelog || item.description);

  return (
    <div className="space-y-3" data-testid="vault-projects-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Sync Status</TableHead>
            <TableHead>Contents</TableHead>
            {showChangelog && <TableHead>Changelog / Context</TableHead>}
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.name} data-testid={`vault-project-row-${item.name}`}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block size-2 rounded-full bg-secondary"
                    data-color={item.color}
                    aria-hidden="true"
                  />
                  <span className="font-semibold">{item.name}</span>
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{versionLabel(item)}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={SYNC_STATUS_VARIANTS[item.syncStatus]}>
                  {SYNC_STATUS_LABELS[item.syncStatus]}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {contentBadges(item).map((badge) => (
                    <Badge key={badge} variant="secondary">
                      {badge}
                    </Badge>
                  ))}
                </span>
              </TableCell>
              {showChangelog && (
                <TableCell className="text-muted-foreground">
                  {item.latestChangelog || item.description || "-"}
                </TableCell>
              )}
              <TableCell>
                <span className="flex items-center gap-1">
                  {item.syncStatus === "NotImported" && (
                    <GatedActionButton
                      gate={gate}
                      variant="outline"
                      size="sm"
                      onClick={() => onImport(item)}
                    >
                      <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                      Import
                    </GatedActionButton>
                  )}

                  {item.syncStatus === "Conflict" && (
                    <>
                      <GatedActionButton gate={gate} size="sm" onClick={() => onMerge(item)}>
                        <GitMerge className="mr-1.5 size-3.5" aria-hidden="true" />
                        Link &amp; Merge
                      </GatedActionButton>
                      <GatedActionButton
                        gate={gate}
                        variant="outline"
                        size="sm"
                        onClick={() => onImport(item)}
                      >
                        <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                        Import As...
                      </GatedActionButton>
                    </>
                  )}

                  {item.syncStatus === "UpdateAvailable" && (
                    <GatedActionButton
                      gate={gate}
                      variant="outline"
                      size="sm"
                      onClick={() => onUpdate(item)}
                    >
                      <CircleArrowUp className="mr-1.5 size-3.5" aria-hidden="true" />
                      Update
                    </GatedActionButton>
                  )}

                  {(item.syncStatus === "UpToDate" ||
                    item.syncStatus === "Modified" ||
                    item.syncStatus === "LocalOnly") && (
                    <GatedActionButton
                      gate={gate}
                      variant="outline"
                      size="sm"
                      tooltip={`Open a PR to update '${item.name}' in vault`}
                      onClick={() => onPublish(item)}
                    >
                      {item.syncStatus === "LocalOnly" ? (
                        <>
                          <Upload className="mr-1.5 size-3.5" aria-hidden="true" />
                          Publish
                        </>
                      ) : (
                        <>
                          <GitPullRequest className="mr-1.5 size-3.5" aria-hidden="true" />
                          Open PR
                        </>
                      )}
                    </GatedActionButton>
                  )}

                  <IconButton
                    label={`Delete '${item.name}' from vault`}
                    variant="danger"
                    size="sm"
                    onClick={() => onDelete(item)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </IconButton>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex">{addTrackedProject}</div>
    </div>
  );
};
