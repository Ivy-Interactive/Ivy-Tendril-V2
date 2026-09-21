/**
 * The whitelist of lucide icons a page's frontmatter `icon:` may name.
 *
 * A whitelist rather than a dynamic lookup on purpose. `Icon` from
 * `@ivy-interactive/components/renderers` resolves names against lucide's whole `icons` map, which
 * defeats tree-shaking and would pull every lucide glyph into the docs bundle for the sake of ten
 * sidebar icons. Naming them explicitly keeps the bundle honest and turns a typo in frontmatter into
 * a console warning plus the fallback glyph instead of a blank square.
 *
 * Adding a section? Add its icon here in alphabetical order and use the same name in frontmatter.
 */
import {
  Activity,
  AppWindow,
  BookOpen,
  Bot,
  Braces,
  Brain,
  Bug,
  ChartBar,
  ClipboardCheck,
  Construction,
  Cpu,
  Database,
  Download,
  Feather,
  FileText,
  FolderGit,
  FolderInput,
  GitBranch,
  GitPullRequest,
  Globe,
  GraduationCap,
  KeyRound,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Link,
  ListChecks,
  Newspaper,
  Package,
  Play,
  Plug,
  RefreshCw,
  Rocket,
  ScrollText,
  Server,
  Settings,
  Shield,
  Snowflake,
  Sparkles,
  Terminal,
  ThumbsUp,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Every icon name frontmatter may use, mapped to its component. */
export const DOC_ICONS: Record<string, LucideIcon> = {
  Activity,
  AppWindow,
  BookOpen,
  Bot,
  Braces,
  Brain,
  Bug,
  ChartBar,
  ClipboardCheck,
  Construction,
  Cpu,
  Database,
  Download,
  Feather,
  FileText,
  FolderGit,
  FolderInput,
  GitBranch,
  GitPullRequest,
  Globe,
  GraduationCap,
  KeyRound,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Link,
  ListChecks,
  Newspaper,
  Package,
  Play,
  Plug,
  RefreshCw,
  Rocket,
  ScrollText,
  Server,
  Settings,
  Shield,
  Snowflake,
  Sparkles,
  Terminal,
  ThumbsUp,
  Users,
  Wrench,
  Zap,
};

/** Shown when a page names no icon, or names one outside {@link DOC_ICONS}. */
export const FALLBACK_ICON: LucideIcon = FileText;

/**
 * True when `name` is a whitelisted icon.
 *
 * A plain boolean rather than a type predicate: `name is string` would narrow the *false* branch of a
 * `string` argument to `never`, which is how a legitimate `${name}` in the warning below ends up
 * reported as an invalid template expression.
 */
export function isKnownIcon(name: string | undefined): boolean {
  return typeof name === "string" && name in DOC_ICONS;
}

const warned = new Set<string>();

/**
 * Resolves a frontmatter `icon:` value. An unknown name warns once and falls back, so a typo never
 * breaks a page — `tests/frontmatter.test.ts` is what fails on it.
 */
export function iconFor(name: string | undefined): LucideIcon {
  if (name === undefined) return FALLBACK_ICON;
  if (isKnownIcon(name)) return DOC_ICONS[name];
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(
      `[tendril-docs] Unknown frontmatter icon "${name}". Add it to src/lib/icons.ts or use one of: ` +
        `${Object.keys(DOC_ICONS).join(", ")}.`,
    );
  }
  return FALLBACK_ICON;
}
