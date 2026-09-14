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
  AppWindow,
  Bot,
  BookOpen,
  Braces,
  Brain,
  ClipboardCheck,
  Cpu,
  Database,
  Download,
  FileText,
  GitBranch,
  Globe,
  GraduationCap,
  KeyRound,
  Layers,
  LifeBuoy,
  ListChecks,
  Newspaper,
  Package,
  Play,
  Plug,
  RefreshCw,
  Rocket,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Every icon name frontmatter may use, mapped to its component. */
export const DOC_ICONS: Record<string, LucideIcon> = {
  AppWindow,
  Bot,
  BookOpen,
  Braces,
  Brain,
  ClipboardCheck,
  Cpu,
  Database,
  Download,
  FileText,
  GitBranch,
  Globe,
  GraduationCap,
  KeyRound,
  Layers,
  LifeBuoy,
  ListChecks,
  Newspaper,
  Package,
  Play,
  Plug,
  RefreshCw,
  Rocket,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Users,
  Wrench,
  Zap,
};

/** Shown when a page names no icon, or names one outside {@link DOC_ICONS}. */
export const FALLBACK_ICON: LucideIcon = FileText;

/** True when `name` is a whitelisted icon. */
export function isKnownIcon(name: string | undefined): name is string {
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
