import {
  Bell,
  Bot,
  Cog,
  Feather,
  FileText,
  Folder,
  FolderGit2,
  ListOrdered,
  Lock,
  Mail,
  Sun,
  Wand,
} from "lucide-react";
import type React from "react";
import type { TFunction } from "../../i18n";

/**
 * `Apps/Settings/SettingsApp.cs`'s section tags, verbatim. They are also the suffix an `activeNav`
 * of `settings:<tag>` carries, so a deep link and V1's `SettingsAppArgs.Section` spell a section the
 * same way.
 */
export const SettingsTag = {
  CodingAgent: "coding-agent",
  Plans: "plans",
  Appearance: "appearance",
  Projects: "projects",
  Vault: "vault",
  Promptwares: "promptwares",
  Levels: "levels",
  Notifications: "notifications",
  Security: "security",
  /** V1 keeps a separate tag that selects the same row and the same view as `security`. */
  Tunnel: "tunnel",
  Advanced: "advanced",
  Newsletter: "newsletter",
} as const;

export type SettingsTagValue = (typeof SettingsTag)[keyof typeof SettingsTag];

/** `selected.Set($"project:{i}")`: a project row's tag is its index in `config.Settings.Projects`. */
export const PROJECT_TAG_PREFIX = "project:";

export const projectTag = (index: number): string => `${PROJECT_TAG_PREFIX}${index}`;

/**
 * The index a `project:<n>` tag names, or `null` for anything else. V1 parses the same suffix with
 * `int.TryParse` and falls back to the first project when it does not resolve.
 */
export const projectIndexOf = (tag: string): number | null => {
  if (!tag.startsWith(PROJECT_TAG_PREFIX)) return null;
  const parsed = Number.parseInt(tag.slice(PROJECT_TAG_PREFIX.length), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

export interface SettingsSection {
  label: string;
  tag: SettingsTagValue;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** `Projects` is the one expandable row, with a sub-item per project plus "Add Project". */
  expandable?: boolean;
}

/**
 * `SettingsApp.Build`'s `sections` list plus its `rows` list, in order: Coding Agent, Plans,
 * Appearance, Projects, Team Vault (beta only), Workflow Agents, Levels, Notifications, Security &
 * Tunneling, Advanced, Newsletter. "Open config.yaml" is deliberately absent - V1 renders it as an
 * action row that never becomes the selection, so it is not a section.
 *
 * `sections` is also what drives the `Breakpoint.Mobile`/`Tablet` `MobileItemPicker`, which is why
 * one list produces both presentations here too.
 *
 * The labels are translated with the `t` it is handed, so the list is built at render time and
 * rebuilt when the language changes; the tags never are, because they are the deep links.
 */
export function settingsSections(isBeta: boolean, t: TFunction<"settings">): SettingsSection[] {
  return [
    { label: t("sections.codingAgent"), tag: SettingsTag.CodingAgent, icon: Bot },
    { label: t("sections.plans"), tag: SettingsTag.Plans, icon: Feather },
    { label: t("sections.appearance"), tag: SettingsTag.Appearance, icon: Sun },
    { label: t("sections.projects"), tag: SettingsTag.Projects, icon: Folder, expandable: true },
    // `if (isBeta) sections.Add(("Team Vault", ...))` - the vault row is gated, not always present.
    ...(isBeta
      ? [
          {
            label: t("sections.vault"),
            tag: SettingsTag.Vault,
            icon: FolderGit2,
          } as SettingsSection,
        ]
      : []),
    /**
     * "Workflow Agents" rather than plain "Agents": `promptwares` is what config, the API and the
     * daemon call these, but the operator-facing name is now "agent" — and this list already has a
     * "Coding Agent" row five above, for the external CLI (Claude Code, Codex, ...) that a workflow
     * agent *runs on*. Two rows both reading "Agent" would be two different things under one word,
     * so the qualifier stays. The tag is untouched: it is the `settings:promptwares` deep link.
     */
    { label: t("sections.promptwares"), tag: SettingsTag.Promptwares, icon: Wand },
    { label: t("sections.levels"), tag: SettingsTag.Levels, icon: ListOrdered },
    { label: t("sections.notifications"), tag: SettingsTag.Notifications, icon: Bell },
    { label: t("sections.security"), tag: SettingsTag.Security, icon: Lock },
    { label: t("sections.advanced"), tag: SettingsTag.Advanced, icon: Cog },
    { label: t("sections.newsletter"), tag: SettingsTag.Newsletter, icon: Mail },
  ];
}

/** The icon on the "Open config.yaml" action row (`Icons.FileText`). */
export const OpenConfigIcon = FileText;

/**
 * `SettingsApp.Build`'s `currentLabel`, used for the mobile picker's trigger. A `project:<n>` tag is
 * not in `sections`, so V1 falls back to "Configuration"; that fallback is kept, but a selected
 * project supplies its own name because otherwise the mobile header would read "Configuration" for
 * every project.
 */
export function sectionLabel(
  tag: string,
  sections: SettingsSection[],
  projectNames: string[],
  t: TFunction<"settings">,
): string {
  const index = projectIndexOf(tag);
  if (index !== null) return projectNames[index] ?? t("sections.fallback");
  return sections.find((section) => section.tag === tag)?.label ?? t("sections.fallback");
}
