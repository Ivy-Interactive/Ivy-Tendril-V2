/**
 * YAML frontmatter splitting for authored docs pages.
 *
 * Same shape as `MarkdownRenderer`'s own `parseFrontmatter` (a `---` fence at the very top, parsed
 * with the `yaml` package), but exported so the docs app can consume the metadata itself and hand
 * `MarkdownRenderer` the body only — otherwise the renderer would print the frontmatter as a
 * metadata card above every page.
 *
 * Malformed YAML warns and degrades to "no frontmatter" instead of throwing: a typo in one page's
 * metadata must not take the whole site down.
 */
import { parse as parseYaml } from "yaml";

/** Recognised frontmatter keys. Unknown keys are kept in `extra` rather than treated as an error. */
export interface Frontmatter {
  /** Page title. Defaults to the first `# ` heading, then to the de-slugged file name. */
  title?: string;
  /** Lead paragraph rendered above the body. Replaces upstream's `<Ingress>` element. */
  description?: string;
  /** `lucide-react` icon name, validated against the whitelist in `lib/icons.ts`. */
  icon?: string;
  /** Extra search terms folded into the search index. */
  searchHints?: string[];
  /** `_Index.md` only: whether the section starts expanded in the sidebar. */
  groupExpanded?: boolean;
  /** Any other key found in the block, ignored by the renderer. */
  extra: Record<string, unknown>;
}

export interface ParsedFrontmatter {
  data: Frontmatter;
  body: string;
}

const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

const KNOWN_KEYS = ["title", "description", "icon", "searchHints", "groupExpanded"] as const;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => asString(item)).filter((item): item is string => !!item);
  return items.length > 0 ? items : undefined;
}

function emptyFrontmatter(): Frontmatter {
  return { extra: {} };
}

/**
 * Splits `content` into its frontmatter and its body. Always returns a body — a page with no
 * frontmatter is the common case, not an error.
 */
export function parseFrontmatter(content: string, contextPath?: string): ParsedFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) {
    return { data: emptyFrontmatter(), body: content };
  }

  const body = match[2] ?? "";
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch (error) {
    console.warn(`Failed to parse frontmatter${contextPath ? ` in ${contextPath}` : ""}:`, error);
    return { data: emptyFrontmatter(), body };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { data: emptyFrontmatter(), body };
  }

  const raw = parsed as Record<string, unknown>;
  const data: Frontmatter = {
    title: asString(raw.title),
    description: asString(raw.description),
    icon: asString(raw.icon),
    searchHints: asStringArray(raw.searchHints),
    groupExpanded: typeof raw.groupExpanded === "boolean" ? raw.groupExpanded : undefined,
    extra: Object.fromEntries(
      Object.entries(raw).filter(([key]) => !KNOWN_KEYS.includes(key as (typeof KNOWN_KEYS)[number])),
    ),
  };

  return { data, body };
}
