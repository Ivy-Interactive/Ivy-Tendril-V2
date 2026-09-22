import React from "react";
import { Download, FolderGit2, GitMerge } from "lucide-react";
import { useTranslation } from "@/i18n/uiVault";
import { Badge } from "../ui/badge";
import { Callout } from "../ui/callout";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { AssetChecklist } from "./AssetChecklist";
import { VaultDialogShell } from "./VaultDialogShell";
import type { LocalProjectRef, VaultCatalogItem, VaultImportRequest } from "./types";
import {
  isLocalProjectNameTaken,
  seedRepoMappings,
  suggestLocalProjectName,
  vaultRepoKey,
} from "./utils";

export interface ImportFromVaultDialogProps {
  open: boolean;
  onClose: () => void;
  item: VaultCatalogItem;
  /** Names of the local projects, used for the collision check and the suggested name. */
  existingNames: string[];
  /** Local projects with their repo paths, so merge mode can preserve where repos already live. */
  localProjects?: LocalProjectRef[];
  /** Repo paths that exist on disk. The dialog is pure, so the caller does the looking. */
  existingPaths?: string[];
  /** Home directory used for the `<home>/git/<repo>` defaults. */
  homeDir: string;
  /** *Link & Merge*: adopt the vault project into the local one of the same name. */
  mergeMode?: boolean;
  onSubmit: (request: VaultImportRequest) => void;
  error?: string | null;
  isBusy?: boolean;
}

/* Each category's label, empty text and row badge are `uiVault` keys named after its `key`. */
const CATEGORIES = [
  { key: "skills", names: (item: VaultCatalogItem) => item.skillNames },
  { key: "mcpServers", names: (item: VaultCatalogItem) => item.mcpServerNames },
  { key: "memories", names: (item: VaultCatalogItem) => item.memoryFileNames },
  { key: "reviewActions", names: (item: VaultCatalogItem) => item.reviewActionNames },
  { key: "verifications", names: (item: VaultCatalogItem) => item.verificationNames },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

/** The name the user asked for, and the free one to suggest instead, when it is taken. */
interface NameCollision {
  name: string;
  suggestion: string;
}

export const ImportFromVaultDialog: React.FC<ImportFromVaultDialogProps> = ({
  open,
  onClose,
  item,
  existingNames,
  localProjects,
  existingPaths,
  homeDir,
  mergeMode = false,
  onSubmit,
  error,
  isBusy = false,
}) => {
  const { t } = useTranslation("uiVault");
  /* Merge keeps the vault's name — that name *is* the link to the local project. */
  const suggestedName = mergeMode ? item.name : suggestLocalProjectName(item.name, existingNames);
  const localMatch = React.useMemo(
    () =>
      localProjects?.find((project) => project.name.toLowerCase() === item.name.toLowerCase()) ??
      null,
    [localProjects, item.name],
  );

  const [name, setName] = React.useState(suggestedName);
  const [mappings, setMappings] = React.useState<Record<string, string>>(() =>
    seedRepoMappings(item.repos, homeDir, mergeMode ? localMatch : null),
  );
  const [selections, setSelections] = React.useState<Record<CategoryKey, string[]>>(() => ({
    skills: [...item.skillNames],
    mcpServers: [...item.mcpServerNames],
    memories: [...item.memoryFileNames],
    reviewActions: [...item.reviewActionNames],
    verifications: [...item.verificationNames],
  }));
  const [importPermissions, setImportPermissions] = React.useState(true);
  const [collision, setCollision] = React.useState<NameCollision | null>(null);

  const effectiveName = name.trim() === "" ? suggestedName : name.trim();
  const existingPathSet = new Set(existingPaths ?? []);
  const submitDisabled = isBusy || effectiveName === "";

  const handleSubmit = () => {
    if (submitDisabled) return;

    /* Importing onto an existing name would silently take over that project, so it is refused —
       except in merge mode, where taking it over is the point, and for an update of a project
       already imported from this vault. */
    if (
      !mergeMode &&
      item.syncStatus !== "UpdateAvailable" &&
      isLocalProjectNameTaken(effectiveName, existingNames)
    ) {
      setCollision({
        name: effectiveName,
        suggestion: suggestLocalProjectName(effectiveName, existingNames),
      });
      return;
    }

    setCollision(null);
    onSubmit({
      sourceVaultId: item.sourceVaultId ?? undefined,
      projectName: item.name,
      targetLocalProjectName: effectiveName,
      localRepoMappings: mappings,
      selectedSkills: selections.skills,
      selectedMcps: selections.mcpServers,
      selectedMemories: selections.memories,
      selectedReviewActions: selections.reviewActions,
      selectedVerifications: selections.verifications,
      importPermissions,
    });
  };

  const nameWasTaken = isLocalProjectNameTaken(item.name, existingNames);

  return (
    <VaultDialogShell
      open={open}
      onClose={onClose}
      title={
        mergeMode
          ? t("importDialog.mergeTitle", { name: item.name })
          : t("importDialog.title", { name: item.name })
      }
      testId={mergeMode ? "merge-vault-dialog" : "import-vault-dialog"}
      error={collision ? t("importDialog.collision", { ...collision }) : error}
      submitLabel={mergeMode ? t("importDialog.mergeSubmit") : t("importDialog.submit")}
      submitIcon={
        mergeMode ? (
          <GitMerge className="mr-1.5 size-3.5" aria-hidden="true" />
        ) : (
          <Download className="mr-1.5 size-3.5" aria-hidden="true" />
        )
      }
      submitDisabled={submitDisabled}
      onSubmit={handleSubmit}
    >
      {mergeMode ? (
        <Callout.Info data-testid="merge-vault-callout">
          {t("importDialog.mergeCallout", { name: item.name })}
        </Callout.Info>
      ) : (
        nameWasTaken &&
        effectiveName !== item.name && (
          <Callout.Info data-testid="import-vault-rename-notice">
            {t("importDialog.renameNotice", { name: item.name, suggestion: effectiveName })}
          </Callout.Info>
        )
      )}

      <div className="space-y-1.5">
        <Label htmlFor="import-vault-name">{t("importDialog.name.label")}</Label>
        <Input
          id="import-vault-name"
          value={mergeMode ? item.name : name}
          readOnly={mergeMode}
          disabled={mergeMode}
          placeholder={suggestedName}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
        {t("importDialog.source", { name: item.name })}
        <Badge variant="secondary">v{item.remoteVersion}</Badge>
      </p>
      {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
      {item.latestChangelog && (
        <p className="text-xs text-muted-foreground">
          {t("importDialog.changelog", { changelog: item.latestChangelog })}
        </p>
      )}

      {item.repos.length > 0 && (
        <section className="space-y-2" data-testid="import-vault-repos">
          <p className="text-xs font-semibold text-foreground">{t("importDialog.repos.heading")}</p>
          <p className="text-xs text-muted-foreground">{t("importDialog.repos.description")}</p>
          <ul className="space-y-2">
            {item.repos.map((repo) => {
              const key = vaultRepoKey(repo);
              const path = mappings[key] ?? "";
              const exists = existingPathSet.has(path);
              return (
                <li key={key} className="space-y-1" data-testid={`import-vault-repo-${key}`}>
                  <span className="flex items-center gap-2 text-xs">
                    <FolderGit2 className="size-3.5" aria-hidden="true" />
                    <span className="font-semibold text-foreground">{key}</span>
                    <Badge variant={exists ? "secondary" : "outline"}>
                      {exists
                        ? t("importDialog.repos.existing")
                        : t("importDialog.repos.willClone")}
                    </Badge>
                  </span>
                  <Input
                    aria-label={t("importDialog.repos.pathAriaLabel", { repo: key })}
                    className="font-mono"
                    value={path}
                    onChange={(event) =>
                      setMappings((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <p className="text-xs font-semibold text-foreground">{t("importDialog.assets.heading")}</p>
        {CATEGORIES.map((category) => (
          <AssetChecklist
            key={category.key}
            label={t(`assetCategories.${category.key}.label`)}
            category={category.key}
            items={[...category.names(item)]}
            selected={selections[category.key]}
            emptyText={t(`importDialog.assets.empty.${category.key}`)}
            itemBadge={t(`assetCategories.${category.key}.badge`)}
            onChange={(next) => setSelections((current) => ({ ...current, [category.key]: next }))}
          />
        ))}
        <label
          className="flex items-center gap-2 text-xs text-foreground"
          htmlFor="import-vault-permissions"
        >
          <Checkbox
            id="import-vault-permissions"
            checked={importPermissions}
            onCheckedChange={(checked) => setImportPermissions(checked === true)}
          />
          {t("importDialog.permissions")}
        </label>
      </section>
    </VaultDialogShell>
  );
};
