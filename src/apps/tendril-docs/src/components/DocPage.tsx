import { useMemo } from "react";
import { MarkdownRenderer, TypographyContext, useTypography } from "@ivy-interactive/components/renderers";
import { cn } from "../lib/cn";
import { rewriteDocLinks } from "../lib/links";
import { splitLeadHeading, type DocPage as DocPageModel } from "../lib/page";
import { useInternalLinkInterceptor } from "../lib/router";

interface DocPageProps {
  page: DocPageModel;
  /** Resolves a `content/assets/...` path to the URL the bundler gave it. */
  resolveAsset?: (contentPath: string) => string | undefined;
  className?: string;
}

/**
 * One documentation page.
 *
 * Two things happen before `MarkdownRenderer` sees the markdown:
 *
 * 1. The frontmatter is already stripped by `parsePage`. `MarkdownRenderer` renders frontmatter as a
 *    visible key/value card, which is right for a plan revision and wrong for a docs page — the
 *    `title` belongs in the heading and the `description` in the lead paragraph.
 *    The file's own `# ` heading is lifted out for the same reason: the header block is
 *    title -> lead paragraph -> prose, which cannot be expressed by prepending anything to markdown.
 * 2. Link targets are rewritten from relative `.md` paths to real routes *in the source*, so the
 *    anchors that reach the DOM carry their final `href`. Hover, middle-click and "copy link address"
 *    then all work, and the renderer's own `urlTransform` (which would turn `../02_Concepts/x.md`
 *    into `/../02_Concepts/x.md`) never sees a relative path.
 */
export function DocPage({ page, resolveAsset, className }: DocPageProps) {
  const baseTypography = useTypography();
  const onClick = useInternalLinkInterceptor();

  const content = useMemo(
    () => rewriteDocLinks(splitLeadHeading(page.body).rest, page.contentPath, resolveAsset),
    [page.body, page.contentPath, resolveAsset],
  );

  // Long-form spacing on top of the library's widget typography: headings need top margin, which a
  // widget rendered inside a flex-gap container does not.
  const typography = useMemo(
    () => ({
      ...baseTypography,
      h1: "text-4xl font-semibold scroll-m-20 mb-3",
      h2: "text-3xl font-medium scroll-m-20 mt-8",
      h3: "text-2xl font-medium scroll-m-20 mt-6 pb-1",
      h4: "text-xl font-medium scroll-m-20 mt-5",
      h5: "text-lg font-medium scroll-m-20 mt-4",
      h6: "text-base font-medium scroll-m-20 mt-4",
      p: `${baseTypography.p} leading-relaxed`,
      li: "list-item leading-relaxed",
    }),
    [baseTypography],
  );

  return (
    <article
      className={cn("docs-article markdown-widget", className)}
      data-content-path={page.contentPath}
      onClick={onClick}
    >
      <h1 id="top" className="mb-3 scroll-m-20 text-4xl font-semibold">
        {page.title}
      </h1>
      {page.description && (
        <p className="mb-6 text-lg leading-relaxed text-muted-foreground">{page.description}</p>
      )}
      <TypographyContext.Provider value={typography}>
        <MarkdownRenderer content={content} />
      </TypographyContext.Provider>
    </article>
  );
}
