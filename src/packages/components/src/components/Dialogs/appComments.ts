/**
 * The reviewer's comments on a running app, and the change request they turn into.
 *
 * Ported from `Apps/ReviewAction/AppPreview` (the `AppComment` record and `FormatChangeRequest`) plus
 * the reducer `AppPreviewView` ran over the widget's three comment events.
 */

/**
 * One comment a reviewer left on an element of the running app, as `WebViewer` reported it.
 *
 * `number` is the number on its pin — a position, so it shifts when an earlier comment is deleted.
 * `url` is the page it was left on, already canonical: the component guarantees one string per page
 * (see `pageUrl.ts`), so grouping by it is plain equality.
 */
export interface AppComment {
  id: string;
  number: number;
  tag: string;
  selector: string;
  comment: string;
  debugJson?: string | null;
  url?: string | null;
  text?: string | null;
  attrsJson?: string | null;
  device?: string | null;
}

/**
 * A `WebViewer` `OnEvent` payload. Every event is a `kind` plus that kind's own fields, so the three
 * comment kinds are picked out by narrowing on `kind` rather than by three separate handlers.
 */
export interface ViewerEvent {
  kind?: string;
  [field: string]: unknown;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A number is a position, so what is left closes ranks — the same thing the pins in the page do. */
function renumber(comments: AppComment[]): AppComment[] {
  return comments.map((comment, index) => ({ ...comment, number: index + 1 }));
}

/**
 * Folds one viewer event into the comment list, returning the list unchanged for anything that is not
 * a comment event — which is most of them: navigation, console output, captures and network entries
 * all arrive through the same channel.
 */
export function applyCommentEvent(comments: AppComment[], event: ViewerEvent): AppComment[] {
  switch (event.kind) {
    case "comment": {
      const id = str(event.id);
      if (!id) return comments;
      const appended: AppComment = {
        id,
        number: comments.length + 1,
        tag: str(event.tag) ?? "",
        selector: str(event.selector) ?? "",
        comment: str(event.comment) ?? "",
        debugJson: str(event.debugJson),
        url: str(event.url),
        text: str(event.text),
        attrsJson: str(event.attrsJson),
        device: str(event.device),
      };
      return renumber([...comments, appended]);
    }

    case "comment-edit": {
      const id = str(event.id);
      const text = str(event.comment);
      if (!id || text === null) return comments;
      return comments.map((c) => (c.id === id ? { ...c, comment: text } : c));
    }

    case "comment-delete": {
      const id = str(event.id);
      if (!id) return comments;
      return renumber(comments.filter((c) => c.id !== id));
    }

    default:
      return comments;
  }
}

/**
 * What the component worked out about where an element came from.
 *
 * `label` is `src/components/SaveButton.tsx:42`, or `null` when nothing resolved — a production bundle
 * with no source map, most often. The rest is what makes that label safe to act on: how it was
 * derived, how sure the resolver is, and which components the element sits inside.
 */
export interface SourceInfo {
  label: string | null;
  provenance: string | null;
  confidence: string | null;
  componentPath: string | null;
}

const NO_SOURCE: SourceInfo = {
  label: null,
  provenance: null,
  confidence: null,
  componentPath: null,
};

/**
 * Reads the attribution payload. Everything here was already being collected and thrown away: only
 * file and line were ever read, so an agent saw a guess and a high-confidence owner-stack hit as the
 * same flat assertion.
 */
export function readSource(debugJson: string | null | undefined): SourceInfo {
  if (!debugJson) return NO_SOURCE;

  let root: unknown;
  try {
    root = JSON.parse(debugJson);
  } catch {
    return NO_SOURCE;
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) return NO_SOURCE;
  const debug = root as Record<string, unknown>;

  let label: string | null = null;
  const source = debug.source;
  if (typeof source === "object" && source !== null) {
    const file = str((source as Record<string, unknown>).file);
    const line = (source as Record<string, unknown>).line;
    if (file) label = typeof line === "number" ? `${file}:${line}` : file;
  }

  // `"none"` is the collector's own placeholder for "did not manage it", not a provenance.
  const word = (name: string): string | null => {
    const value = str(debug[name]);
    return value !== null && value !== "none" ? value : null;
  };

  let componentPath: string | null = null;
  const chain = debug.ownerChain;
  if (Array.isArray(chain)) {
    const names = chain
      .map((entry) =>
        typeof entry === "object" && entry !== null
          ? str((entry as Record<string, unknown>).name)
          : null,
      )
      .filter((name): name is string => name !== null);
    if (names.length > 0) componentPath = names.join(" > ");
  }

  return {
    label,
    provenance: word("provenance"),
    confidence: word("confidence"),
    componentPath,
  };
}

/**
 * Attributes that identify the element in the SOURCE, most stable first. A `data-testid` or an
 * `aria-label` is something an agent can grep for; `div > button:nth-child(1)` is something it has to
 * solve. Capped, because an element can carry a lot of them.
 */
const IDENTIFYING_ATTRIBUTES = [
  "data-testid",
  "data-test-id",
  "id",
  "aria-label",
  "name",
  "placeholder",
  "href",
];

export function attributeLabel(attrsJson: string | null | undefined): string | null {
  if (!attrsJson) return null;

  let root: unknown;
  try {
    root = JSON.parse(attrsJson);
  } catch {
    return null;
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) return null;
  const attrs = root as Record<string, unknown>;

  const parts: string[] = [];
  for (const name of IDENTIFYING_ATTRIBUTES) {
    if (parts.length === 3) break;
    const value = str(attrs[name]);
    if (value !== null) parts.push(`${name}="${value}"`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/** Groups by page, keeping both the pages and the comments within them in the order they arrived. */
function groupByPage(url: string, comments: AppComment[]): Array<[string, AppComment[]]> {
  const pages = new Map<string, AppComment[]>();
  for (const comment of comments) {
    const page = comment.url ?? url;
    const existing = pages.get(page);
    if (existing) existing.push(comment);
    else pages.set(page, [comment]);
  }
  return [...pages.entries()];
}

/**
 * Turns the reviewer's comments into a change request an agent can act on.
 *
 * Three things here are deliberate, because each one is a way an agent goes wrong without it:
 * the grouping by page, leading with a *qualified* source location, and printing the selector only
 * when nothing else resolved.
 */
export function formatChangeRequest(url: string, comments: AppComment[]): string {
  const lines: string[] = [];
  lines.push(`Feedback from reviewing the running app at ${url}`);
  lines.push("");
  // Two things an agent gets wrong without being told. A source location is where the element was
  // RENDERED from, which for anything built on a design system is the shared primitive — edit that and
  // every screen changes, when one screen was meant. And a location is sometimes a guess; saying so is
  // what lets the agent check first instead of editing confidently in the wrong file.
  lines.push(
    "Each item is a comment left on one element of the running app. Where a source location is " +
      "given it is where that element was rendered from, which for a shared component is the " +
      "primitive rather than the thing being complained about - when a component path is also " +
      "given, the change usually belongs at the call site it names, not in the primitive. Treat any " +
      "location not marked high confidence as a lead to verify rather than a fact.",
  );
  lines.push("");

  // Under the page each comment was left on. A reviewer walks several screens in one pass, and a flat
  // list of notes about three different pages is one the agent has to guess its way through — "make
  // this green" says nothing without knowing where "this" was.
  for (const [page, pageComments] of groupByPage(url, comments)) {
    lines.push(`## ${page}`);
    lines.push("");

    for (const comment of pageComments) {
      const tag = comment.tag ? `<${comment.tag}>` : "element";
      // The element's own words, which usually identify it outright and, unlike a selector, can be
      // searched for in the source.
      const quoted = comment.text?.trim() ? ` “${comment.text.trim()}”` : "";

      lines.push(`- **${comment.number}. ${tag}**${quoted}`);
      lines.push(`  ${comment.comment.trim()}`);

      const source = readSource(comment.debugJson);
      if (source.label !== null) {
        const how = [source.confidence, source.provenance].filter((part) => part).join(", ");
        lines.push(
          how.length > 0
            ? `  source: \`${source.label}\` (${how})`
            : `  source: \`${source.label}\``,
        );
      }

      if (source.componentPath !== null) lines.push(`  component: ${source.componentPath}`);

      const attributes = attributeLabel(comment.attrsJson);
      if (attributes !== null) lines.push(`  attributes: ${attributes}`);

      // The selector earns its line when nothing resolved, where it is the only handle on the element
      // left. Printed beside a file, a line and a component path it is the least useful thing there,
      // and printing it every time is how a reader learns to skip the one case that needed it.
      if (source.label === null && comment.selector)
        lines.push(`  selector: \`${comment.selector}\``);

      if (comment.device) lines.push(`  viewport: ${comment.device}`);

      lines.push("");
    }
  }

  return lines.join("\n").trim();
}
