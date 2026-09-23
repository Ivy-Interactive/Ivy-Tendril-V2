import type { Meta, StoryObj } from "@storybook/react";
import { ImportRepoAssetsDialog, type DiscoveredRepoAsset } from "./ImportRepoAssetsDialog";

const SKILLS: DiscoveredRepoAsset[] = [
  {
    name: "release",
    sourcePath: ".agents/skills/release",
    detail: "Cuts a release branch, bumps versions and drafts the changelog.",
  },
  {
    name: "code-review",
    sourcePath: ".agents/skills/code-review",
    detail: "Reviews the current diff for correctness bugs.",
  },
  {
    name: "i18n-extract",
    sourcePath: "skills/i18n-extract",
    detail: "Moves hard-coded strings into the locale catalogs and translates them.",
  },
];

const MCP_SERVERS: DiscoveredRepoAsset[] = [
  {
    name: "github",
    sourcePath: ".mcp.json",
    detail: "npx -y @modelcontextprotocol/server-github",
  },
  {
    name: "sqlite",
    sourcePath: ".vscode/mcp.json",
    detail: "npx -y @modelcontextprotocol/server-sqlite --db ./data/tendril.db",
  },
];

const REPOS = ["/home/dev/git/Ivy-Tendril-V2", "/home/dev/git/Ivy-Framework"];

/**
 * V1's `Apps/Settings/Dialogs/ImportRepoAssetsDialog.cs`, opened from a project's custom skills or
 * MCP servers table. The source is one of the project's repos (scanned as soon as it is picked), a
 * git URL, or a local folder; what the scan finds is listed ticked, and *Import Selected (n)* takes
 * the ticked ones.
 */
const meta: Meta<typeof ImportRepoAssetsDialog> = {
  title: "Dialogs/ImportRepoAssetsDialog",
  component: ImportRepoAssetsDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onScan: () => {},
    onImport: () => {},
    kind: "skills",
    projectRepos: REPOS,
    items: SKILLS,
  },
};

export default meta;
type Story = StoryObj<typeof ImportRepoAssetsDialog>;

/** Skills found in the project's first repo, all ticked. */
export const SkillsFound: Story = {};

/** MCP servers, whose detail line is the command they run. */
export const McpServersFound: Story = {
  args: { kind: "mcpServers", items: MCP_SERVERS },
};

/** The scan is running (a URL may be cloning first). */
export const Scanning: Story = {
  args: { items: null, isScanning: true },
};

/** The repo has nothing of this kind. */
export const NothingFound: Story = {
  args: { kind: "mcpServers", items: [] },
};

/** The source could not be resolved — a clone failed, or the folder does not exist. */
export const ScanFailed: Story = {
  args: {
    items: null,
    scanError:
      "git clone failed: Repository not found. Check the URL and that your GitHub account can read it.",
  },
};

/** A project with no repos starts on the git URL source, with nothing scanned yet. */
export const NoProjectRepos: Story = {
  args: { projectRepos: [], items: null },
};

/** The import is running. */
export const Importing: Story = {
  args: { isImporting: true },
};

/** The import was refused; the selection stays. */
export const ImportFailed: Story = {
  args: { error: "Failed to copy skill 'release': Access is denied. (os error 5)" },
};
