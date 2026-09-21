import { type ProjectEntry, type VerificationDef } from "../projectConfig";

export interface ProjectSettingsViewProps {
  project: ProjectEntry;
  /** The top-level `verifications` registry - a project can only enable what it defines. */
  verificationDefs: VerificationDef[];
  /** The configured coding agent, for the enforcement note on the security block. */
  agent: string;
  isBeta: boolean;
  /** Writes one top-level config key and re-reads the config. */
  onSaveRaw: (key: string, value: unknown) => Promise<void>;
  /**
   * Re-reads `config.yaml` without writing anything. Adding a remote repository goes out as its own
   * daemon route rather than a config write, so this is how its result gets back into the view.
   */
  onReloadConfig: () => Promise<void>;
  /**
   * Every *other* project's name, for the duplicate check `EditProjectBladeView` runs before it will
   * enable Save. The daemon answers 409 on a collision regardless; checking here is what turns that
   * into a message under the field instead of a failed round trip.
   */
  siblingNames?: string[];
  /**
   * Called once the project's `config.yaml` entry is gone but its data is still on disk, so the
   * parent can move the selection off it.
   */
  onRemoved?: (name: string) => void;
  /**
   * Called once the project and everything it owned on disk are gone. Separate from
   * {@link onRemoved} only so the parent can say which of the two happened - the selection has to
   * move either way.
   */
  onDeleted?: (name: string) => void;
}

export const AGENT_LABELS: Record<string, string> = {
  claude: "Claude",
  copilot: "Copilot",
  codex: "Codex",
  gemini: "Gemini",
  antigravity: "Antigravity",
  opencode: "OpenCode",
};
