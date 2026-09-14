import { emojiMap } from "./emojiMap";
import type { RootContent, Node, Parent, Text, Image } from "mdast";
import { visit } from "unist-util-visit";

export function remarkCustomEmojiPlugin() {
  return (tree: Node) => {
    visit(tree, "text", (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || !node.value || index === undefined) return;

      const parts = node.value.split(/(:[a-zA-Z0-9-_]+:)/g);
      if (parts.length === 1) return;

      const newNodes: RootContent[] = parts.map<RootContent>((part) => {
        if (part.startsWith(":") && part.endsWith(":")) {
          const imgNode: Image = {
            type: "image",
            url: emojiMap[part]?.src || "",
            alt: part,
            data: {
              hName: "emoji",
              hProperties: { name: part },
            },
          };
          return imgNode;
        }
        const textNode: Text = { type: "text", value: part };
        return textNode;
      });

      parent.children.splice(index, 1, ...newNodes);
    });
  };
}
