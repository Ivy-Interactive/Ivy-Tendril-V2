import React from "react";
import { ChevronDown, GitPullRequest } from "lucide-react";
import { Badge } from "../ui/badge";
import { Callout } from "../ui/callout";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { AssetChecklist } from "./AssetChecklist";
import { VaultDialogShell } from "./VaultDialogShell";
import type { ProjectAssets, VaultExportRequest } from "./types";
import { generateVaultVersion, parseReviewers } from "./utils";

/**
 * What the push dialog can decide on its own. The PR title and body are composed by the view, which
 * knows the vault the PR is opened against.
 */
export type VaultExportDraft = Omit<VaultExportRequest, "prTitle" | "prBody">;

export interface PushToVaultDialogProps {
  open: boolean;
  onClose: () => void;
  /** Repo name of the vault being published to, for the dialog title. */
  vaultDisplayName: string;
  targetVaultId?: string;
  availableProjects: string[];
  /** Assets per project; a project with no entry is treated as having none. */
  assets: ProjectAssets[];
  /** Preselected project, e.g. the row whose *Open PR* was clicked. */
  defaultProject?: string | null;
  onSubmit: (draft: VaultExportDraft) => void;
  error?: string | null;
  /** Set once the PR exists, so the dialog can show where it went. */
  prUrl?: string | null;
  isBusy?: boolean;
}

const EMPTY_ASSETS: Omit<ProjectAssets, "projectName"> = {
  skills: [],
  mcpServers: [],
  memories: [],
  reviewActions: [],
  verifications: [],
};

type AssetCategory = keyof typeof EMPTY_ASSETS;

/** Keyed by project name, so one PR can publish several projects with different asset subsets. */
type SelectionMap = Record<string, string[]>;

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  skills: "Skills",
  mcpServers: "MCP Servers",
  memories: "Project Memories",
  reviewActions: "Review Actions",
  verifications: "Verifications",
};

const CATEGORY_EMPTY_TEXT: Record<AssetCategory, string> = {
  skills: "No custom skills configured for this project.",
  mcpServers: "No MCP servers configured for this project.",
  memories: "No memory markdown files found for this project.",
  reviewActions: "No review actions configured for this project.",
  verifications: "No verifications configured for this project.",
};

/** The kind badge each asset row carries, from `PushAssetItemRow`'s `badge` argument. */
const CATEGORY_ITEM_BADGES: Record<AssetCategory, string> = {
  skills: "Skill",
  mcpServers: "MCP",
  memories: "Memory",
  reviewActions: "Action",
  verifications: "Verification",
};

/** The short word the header summary counts each category in, from `PushProjectHeaderBadge`. */
const CATEGORY_SUMMARY_WORDS: Record<AssetCategory, string> = {
  skills: "skills",
  mcpServers: "MCPs",
  memories: "mems",
  reviewActions: "actions",
  verifications: "verifs",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as AssetCategory[];

function assetsFor(
  assets: ProjectAssets[],
  projectName: string,
): Omit<ProjectAssets, "projectName"> {
  return assets.find((entry) => entry.projectName === projectName) ?? EMPTY_ASSETS;
}

/** Everything preselected, mirroring the original: publishing a project means publishing its assets. */
function selectAll(
  projects: string[],
  assets: ProjectAssets[],
  category: AssetCategory,
): SelectionMap {
  const map: SelectionMap = {};
  for (const project of projects) map[project] = [...assetsFor(assets, project)[category]];
  return map;
}

export const PushToVaultDialog: React.FC<PushToVaultDialogProps> = ({
  open,
  onClose,
  vaultDisplayName,
  targetVaultId,
  availableProjects,
  assets,
  defaultProject,
  onSubmit,
  error,
  prUrl,
  isBusy = false,
}) => {
  const [selectedProjects, setSelectedProjects] = React.useState<string[]>(() =>
    defaultProject ? [defaultProject] : [...availableProjects],
  );
  const [selections, setSelections] = React.useState<Record<AssetCategory, SelectionMap>>(() => ({
    skills: selectAll(availableProjects, assets, "skills"),
    mcpServers: selectAll(availableProjects, assets, "mcpServers"),
    memories: selectAll(availableProjects, assets, "memories"),
    reviewActions: selectAll(availableProjects, assets, "reviewActions"),
    verifications: selectAll(availableProjects, assets, "verifications"),
  }));
  const [syncPermissions, setSyncPermissions] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(availableProjects.map((name) => [name, true])),
  );
  /* `Expandable(...).Open(isProjectChecked)`: a project opens when it is ticked, and can still be
     opened by hand to look at what would go out if it were. */
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [version, setVersion] = React.useState(() => generateVaultVersion());
  const [changelog, setChangelog] = React.useState("");
  const [reviewers, setReviewers] = React.useState("");

  const setCategory = (category: AssetCategory, project: string, next: string[]) => {
    setSelections((current) => ({
      ...current,
      [category]: { ...current[category], [project]: next },
    }));
  };

  const toggleProject = (project: string, checked: boolean) => {
    setSelectedProjects((current) =>
      checked
        ? availableProjects.filter((name) => name === project || current.includes(name))
        : current.filter((name) => name !== project),
    );
    setExpanded((current) => ({ ...current, [project]: checked }));
  };

  /**
   * `selected/total` per non-empty category, joined with bullets — the `PushProjectHeaderBadge`
   * summary. A project with nothing to publish says so rather than showing `0/0` five times.
   */
  const assetSummary = (project: string): string => {
    const projectAssets = assetsFor(assets, project);
    const parts = CATEGORIES.filter((category) => projectAssets[category].length > 0).map(
      (category) =>
        `${(selections[category][project] ?? []).length}/${projectAssets[category].length} ${
          CATEGORY_SUMMARY_WORDS[category]
        }`,
    );
    return parts.length > 0 ? parts.join(" • ") : "0 assets";
  };

  const submitDisabled = isBusy || selectedProjects.length === 0;

  return (
    <VaultDialogShell
      open={open}
      onClose={onClose}
      title={`Add Project to ${vaultDisplayName} (Create PR)`}
      testId="push-vault-dialog"
      error={error}
      submitLabel="Publish & Open PR"
      submitIcon={<GitPullRequest className="mr-1.5 size-3.5" aria-hidden="true" />}
      submitDisabled={submitDisabled}
      onSubmit={() => {
        if (submitDisabled) return;
        onSubmit({
          targetVaultId,
          projectNames: selectedProjects,
          version: version.trim(),
          changelog: changelog.trim(),
          reviewers: parseReviewers(reviewers),
          selectedSkills: selections.skills,
          selectedMcps: selections.mcpServers,
          selectedMemories: selections.memories,
          selectedReviewActions: selections.reviewActions,
          selectedVerifications: selections.verifications,
          syncPermissions,
        });
      }}
    >
      <section className="space-y-2">
        <p className="text-xs font-semibold text-foreground">Projects &amp; Assets to Publish</p>
        {availableProjects.length === 0 ? (
          <Callout.Info data-testid="push-vault-no-projects">
            All local projects are already tracked by a vault. Create a new local project first to
            add it here.
          </Callout.Info>
        ) : (
          /* Every local project is listed, ticked or not, so the assets of one you have not chosen
             are still inspectable — the `projectSelectorList` loop over `availableProjects`. */
          availableProjects.map((project) => {
            const projectAssets = assetsFor(assets, project);
            const isSelected = selectedProjects.includes(project);
            const checkboxId = `push-select-${project}`;

            return (
              <Collapsible
                key={project}
                open={expanded[project] ?? isSelected}
                onOpenChange={(next) => setExpanded((current) => ({ ...current, [project]: next }))}
                className="rounded-box border border-border"
                data-testid={`push-project-${project}`}
              >
                <div className="flex items-center gap-2 px-2 py-1">
                  <label
                    className="flex items-center gap-2 text-xs font-semibold text-foreground"
                    htmlFor={checkboxId}
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={isSelected}
                      onCheckedChange={(checked) => toggleProject(project, checked === true)}
                    />
                    {project}
                  </label>
                  <Badge variant="secondary">{assetSummary(project)}</Badge>
                  <CollapsibleTrigger
                    className="group ml-auto rounded-selector p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                    aria-label={`Assets for ${project}`}
                  >
                    <ChevronDown
                      className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180"
                      aria-hidden="true"
                    />
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="space-y-1.5 px-2 pb-2">
                  {CATEGORIES.map((category) => (
                    <AssetChecklist
                      key={category}
                      label={CATEGORY_LABELS[category]}
                      category={category}
                      scope={project}
                      items={projectAssets[category]}
                      selected={selections[category][project] ?? []}
                      emptyText={CATEGORY_EMPTY_TEXT[category]}
                      itemBadge={CATEGORY_ITEM_BADGES[category]}
                      onChange={(next) => setCategory(category, project, next)}
                    />
                  ))}
                  <label
                    className="flex items-center gap-2 px-2 text-xs text-foreground"
                    htmlFor={`push-permissions-${project}`}
                  >
                    <Checkbox
                      id={`push-permissions-${project}`}
                      checked={syncPermissions[project] ?? true}
                      onCheckedChange={(checked) =>
                        setSyncPermissions((current) => ({
                          ...current,
                          [project]: checked === true,
                        }))
                      }
                    />
                    Include Security &amp; Permissions Policies
                  </label>
                </CollapsibleContent>
              </Collapsible>
            );
          })
        )}
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold text-foreground">Release Details</p>
        <div className="space-y-1.5">
          <Label htmlFor="push-vault-version">Version Tag (UTC Timestamp)</Label>
          <Input
            id="push-vault-version"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="push-vault-changelog">Changelog / Release Notes</Label>
          <Textarea
            id="push-vault-changelog"
            value={changelog}
            placeholder="Summary of updates, new skills, MCP servers, or security policy changes..."
            onChange={(event) => setChangelog(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="push-vault-reviewers">Request PR Reviewers</Label>
          <Input
            id="push-vault-reviewers"
            value={reviewers}
            placeholder="e.g. alice, bob (comma-separated GitHub usernames)"
            onChange={(event) => setReviewers(event.target.value)}
          />
        </div>
      </section>

      {/* The dialog stays open on success so the PR link lands here, the way `createdPrUrl` does. */}
      {prUrl && (
        <Callout.Success data-testid="push-vault-pr-url">
          Pull request opened successfully: {prUrl}
        </Callout.Success>
      )}
    </VaultDialogShell>
  );
};
