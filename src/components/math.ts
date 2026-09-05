import remarkGfm from "remark-gfm";
import type { Options } from "react-markdown";

type MarkdownPlugins = Required<Pick<Options, "remarkPlugins" | "rehypePlugins">>;

export const getMarkdownPlugins = (_content: string): MarkdownPlugins => {
  return {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [],
  };
};
