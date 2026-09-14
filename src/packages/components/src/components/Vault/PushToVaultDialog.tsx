import React from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { MultipleSelector, type Option } from "../ui/multiselect";
import { Switch } from "../ui/switch";
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
  const projectOptions: Option[] = availableProjects.map((name) => ({ label: name, value: name }));

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
  const [version, setVersion] = React.useState(() => generateVaultVersion());
  const [changelog, setChangelog] = React.useState("");
  const [reviewers, setReviewers] = React.useState("");

  const setCategory = (category: AssetCategory, project: string, next: string[]) => {
    setSelections((current) => ({
      ...current,
      [category]: { ...current[category], [project]: next },
    }));
  };

  const submitDisabled = isBusy || selectedProjects.length === 0;

  return (
    <VaultDialogShell
      open={open}
      onClose={onClose}
      title={`Add Project to ${vaultDisplayName} (Create PR)`}
      description="Publishing opens a pull request against the vault; nothing changes for your team until it is merged."
      testId="push-vault-dialog"
      error={error}
      submitLabel="Publish & Open PR"
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
          <p className="text-xs text-muted-foreground">
            All local projects are already tracked by a vault. Create a new local project first to
            add it here.
          </p>
        ) : (
          <MultipleSelector
            searchable
            placeholder="Select projects..."
            defaultOptions={projectOptions}
            value={projectOptions.filter((option) => selectedProjects.includes(option.value))}
            commandProps={{ label: "Projects to publish" }}
            onValueChange={(options) => setSelectedProjects(options.map((option) => option.value))}
          />
        )}
      </section>

      {selectedProjects.map((project) => {
        const projectAssets = assetsFor(assets, project);
        const total = CATEGORIES.reduce((sum, category) => sum + projectAssets[category].length, 0);

        return (
          <Collapsible
            key={project}
            defaultOpen
            className="rounded-box border border-border p-3"
            data-testid={`push-project-${project}`}
          >
            <CollapsibleTrigger className="flex w-full items-center gap-2 text-left text-xs font-semibold text-foreground">
              <ChevronDown className="size-3.5" aria-hidden="true" />
              {project}
              <Badge variant="secondary">{total === 0 ? "0 assets" : `${total} assets`}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              {CATEGORIES.map((category) => (
                <AssetChecklist
                  key={category}
                  label={CATEGORY_LABELS[category]}
                  category={category}
                  scope={project}
                  items={projectAssets[category]}
                  selected={selections[category][project] ?? []}
                  emptyText={CATEGORY_EMPTY_TEXT[category]}
                  onChange={(next) => setCategory(category, project, next)}
                />
              ))}
              <label className="flex items-center gap-2 text-xs text-foreground">
                <Switch
                  checked={syncPermissions[project] ?? true}
                  aria-label={`Include Security & Permissions Policies for ${project}`}
                  onCheckedChange={(checked) =>
                    setSyncPermissions((current) => ({ ...current, [project]: checked }))
                  }
                />
                Include Security &amp; Permissions Policies
              </label>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

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

      {prUrl && (
        <p className="text-xs text-success" data-testid="push-vault-pr-url">
          Pull request opened successfully: {prUrl}
        </p>
      )}
    </VaultDialogShell>
  );
};
