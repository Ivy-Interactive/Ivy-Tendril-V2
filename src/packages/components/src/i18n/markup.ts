/**
 * The tag syntax `<Trans>` strings use: named tags without attributes - `<link>…</link>`,
 * `<strong>…</strong>` - and self-closing ones, `<br/>`. Attributes belong on the component the tag
 * maps to, not in a string a translator edits.
 *
 * The parse never throws. A translation is data somebody else typed, and a stray `<` must cost that
 * one string its formatting, not the screen it is on. Whatever does not form a well-nested tag is
 * kept as text: a closing tag with nothing open to close, and the opening tag of an element that is
 * never closed (its content is kept, unwrapped, in place). Each is also listed in `unpaired`, so
 * `<Trans>` can report it - a silent fallback would ship a sentence with its markup showing.
 */

export type MarkupNode =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "element"; readonly name: string; readonly children: readonly MarkupNode[] };

export interface ParsedMarkup {
  nodes: MarkupNode[];
  /** Every tag that paired with nothing and was kept as text, as written: `<hash>`, `</strong>`. */
  unpaired: string[];
}

const TAG = /<(\/?)([A-Za-z][\w-]*)\s*(\/?)>/g;

/** Appends text, merging it into a preceding text node so the output never splits a run of text. */
function appendText(nodes: MarkupNode[], text: string): void {
  if (text === "") return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    nodes[nodes.length - 1] = { type: "text", text: last.text + text };
  } else {
    nodes.push({ type: "text", text });
  }
}

function appendNode(nodes: MarkupNode[], node: MarkupNode): void {
  if (node.type === "text") appendText(nodes, node.text);
  else nodes.push(node);
}

export function parseMarkup(source: string): ParsedMarkup {
  const root: MarkupNode[] = [];
  const unpaired: string[] = [];
  const open: { name: string; raw: string; children: MarkupNode[] }[] = [];
  const siblings = () => (open.length > 0 ? open[open.length - 1].children : root);
  const keepAsText = (raw: string) => {
    appendText(siblings(), raw);
    unpaired.push(raw);
  };

  let cursor = 0;
  for (const match of source.matchAll(TAG)) {
    const [raw, closing, name, selfClosing] = match;
    appendText(siblings(), source.slice(cursor, match.index));
    cursor = match.index + raw.length;

    if (selfClosing) {
      // `</x/>` is not a tag in any dialect.
      if (closing) keepAsText(raw);
      else siblings().push({ type: "element", name, children: [] });
    } else if (!closing) {
      open.push({ name, raw, children: [] });
    } else if (open.length > 0 && open[open.length - 1].name === name) {
      const element = open.pop()!;
      siblings().push({ type: "element", name, children: element.children });
    } else {
      keepAsText(raw);
    }
  }
  appendText(siblings(), source.slice(cursor));

  // Unwind whatever was never closed, innermost first.
  while (open.length > 0) {
    const element = open.pop()!;
    const parent = siblings();
    appendText(parent, element.raw);
    unpaired.push(element.raw);
    for (const child of element.children) appendNode(parent, child);
  }
  return { nodes: root, unpaired };
}
