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
import { useTranslation, type TFunction } from "@/i18n/uiVault";
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

/** Each sync status's label. A status the daemon added after this build is shown as it comes. */
const SYNC_STATUS_LABEL_KEYS: Record<VaultItemSyncStatus, Parameters<TFunction>[0]> = {
  UpToDate: "projectsTable.syncStatus.upToDate",
  Modified: "projectsTable.syncStatus.modified",
  UpdateAvailable: "projectsTable.syncStatus.updateAvailable",
  LocalOnly: "projectsTable.syncStatus.localOnly",
  NotImported: "projectsTable.syncStatus.notImported",
  Conflict: "projectsTable.syncStatus.conflict",
};

function syncStatusLabel(t: TFunction, status: VaultItemSyncStatus): string {
  const key = Object.prototype.hasOwnProperty.call(SYNC_STATUS_LABEL_KEYS, status)
    ? SYNC_STATUS_LABEL_KEYS[status]
    : undefined;
  return key ? t(key) : status;
}

const SYNC_STATUS_VARIANTS: Record<VaultItemSyncStatus, "secondary" | "outline" | "destructive"> = {
  UpToDate: "secondary",
  Modified: "outline",
  UpdateAvailable: "destructive",
  LocalOnly: "outline",
  NotImported: "outline",
  Conflict: "destructive",
};

/** The asset counts a row can carry, in badge order; each names its `projectsTable.contents` key. */
const CONTENT_COUNTS = [
  ["repos", (item: VaultCatalogItem) => item.reposCount],
  ["skills", (item: VaultCatalogItem) => item.skillsCount],
  ["mcps", (item: VaultCatalogItem) => item.mcpsCount],
  ["memories", (item: VaultCatalogItem) => item.memoriesCount],
  ["reviewActions", (item: VaultCatalogItem) => item.reviewActionsCount],
  ["verifications", (item: VaultCatalogItem) => item.verificationsCount],
] as const;

/** The content badges, each shown only when the project actually carries that kind of asset. */
function contentBadges(t: TFunction, item: VaultCatalogItem): { id: string; label: string }[] {
  return CONTENT_COUNTS.flatMap(([id, countOf]) => {
    const count = countOf(item);
    return count > 0 ? [{ id, label: t(`projectsTable.contents.${id}`, { count }) }] : [];
  });
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
  const { t } = useTranslation("uiVault");
  const addTrackedProject = (
    <GatedActionButton gate={gate} variant="outline" size="sm" onClick={onAddTrackedProject}>
      <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
      {t("projectsTable.addTrackedProject")}
    </GatedActionButton>
  );

  if (isLoading && items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="vault-projects-loading">
        {t("projectsTable.loading")}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-2" data-testid="vault-projects-empty">
        <p className="text-sm font-semibold text-foreground">{t("projectsTable.empty.title")}</p>
        <p className="text-xs text-muted-foreground">{t("projectsTable.empty.description")}</p>
        <div className="flex">{addTrackedProject}</div>
      </div>
    );
  }

  /* The changelog column earns its width only when some row has something to put in it. */
  const showChangelog = items.some((item) => item.latestChangelog || item.description);

  /* Column order is `VaultProjectTableRow`'s declaration order in `VaultSetupView.cs`, which is what
     `TableBuilder` scaffolds from: Project, Version, Actions, Sync Status, Contents, Changelog. The
     actions sitting third rather than last is the original's ordering, not a preference here. */
  return (
    <div className="space-y-3" data-testid="vault-projects-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("projectsTable.columns.project")}</TableHead>
            <TableHead>{t("projectsTable.columns.version")}</TableHead>
            <TableHead>{t("projectsTable.columns.actions")}</TableHead>
            <TableHead>{t("projectsTable.columns.syncStatus")}</TableHead>
            <TableHead>{t("projectsTable.columns.contents")}</TableHead>
            {showChangelog && <TableHead>{t("projectsTable.columns.changelog")}</TableHead>}
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
                <span className="flex items-center gap-1">
                  {item.syncStatus === "NotImported" && (
                    <GatedActionButton
                      gate={gate}
                      variant="outline"
                      size="sm"
                      onClick={() => onImport(item)}
                    >
                      <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                      {t("projectsTable.actions.import")}
                    </GatedActionButton>
                  )}

                  {item.syncStatus === "Conflict" && (
                    <>
                      <GatedActionButton gate={gate} size="sm" onClick={() => onMerge(item)}>
                        <GitMerge className="mr-1.5 size-3.5" aria-hidden="true" />
                        {t("projectsTable.actions.linkMerge")}
                      </GatedActionButton>
                      <GatedActionButton
                        gate={gate}
                        variant="outline"
                        size="sm"
                        onClick={() => onImport(item)}
                      >
                        <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                        {t("projectsTable.actions.importAs")}
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
                      {t("projectsTable.actions.update")}
                    </GatedActionButton>
                  )}

                  {(item.syncStatus === "UpToDate" ||
                    item.syncStatus === "Modified" ||
                    item.syncStatus === "LocalOnly") && (
                    <GatedActionButton
                      gate={gate}
                      variant="outline"
                      size="sm"
                      tooltip={t("projectsTable.actions.publishTooltip", { name: item.name })}
                      onClick={() => onPublish(item)}
                    >
                      {item.syncStatus === "LocalOnly" ? (
                        <>
                          <Upload className="mr-1.5 size-3.5" aria-hidden="true" />
                          {t("projectsTable.actions.publish")}
                        </>
                      ) : (
                        <>
                          <GitPullRequest className="mr-1.5 size-3.5" aria-hidden="true" />
                          {t("projectsTable.actions.openPr")}
                        </>
                      )}
                    </GatedActionButton>
                  )}

                  <IconButton
                    label={t("projectsTable.actions.delete", { name: item.name })}
                    variant="danger"
                    size="sm"
                    onClick={() => onDelete(item)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </IconButton>
                </span>
              </TableCell>
              <TableCell>
                <Badge variant={SYNC_STATUS_VARIANTS[item.syncStatus]}>
                  {syncStatusLabel(t, item.syncStatus)}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {contentBadges(t, item).map((badge) => (
                    <Badge key={badge.id} variant="secondary">
                      {badge.label}
                    </Badge>
                  ))}
                </span>
              </TableCell>
              {showChangelog && (
                <TableCell className="text-muted-foreground">
                  {item.latestChangelog || item.description || "-"}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex">{addTrackedProject}</div>
    </div>
  );
};
