import React, { memo, useMemo, useCallback } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkGemoji from "remark-gemoji";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import "katex/dist/katex.min.css";
import { cn, getIvyHost, convertAppUrlToPath, isLocalFilesEnabled } from "@/lib/utils";
import {
  validateLinkUrl,
  validateMediaUrl,
  isExternalUrl,
  isAnchorLink,
  isAppProtocol,
  extractAnchorId,
} from "@/lib/url";
import { hasRawHtml, rawHtmlSchema } from "@/lib/rawHtml";
import { getRehypeKatex, loadRehypeKatex } from "@/lib/math";
import { useMathReady } from "@/hooks/use-math-ready";
import { useTypography } from "@/contexts/TypographyContext";
import { CustomEmoji } from "./custom-emojis/CustomEmoji";
import { remarkCustomEmojiPlugin } from "./custom-emojis/remarkCustomEmojiPlugin";

import { ImageOverlay } from "./markdown/ImageOverlay";
import { MarkdownCodeBlock } from "./markdown/MarkdownCodeBlock";
import { PopoverLink } from "./markdown/PopoverLink";
import { Icon } from "@/components/Icon";
import type { Components, Options } from "react-markdown";
import {
  parseGitHubAlert,
  githubAlertStyles,
  githubAlertTitle,
  extractTextContent,
} from "@/lib/markdown-utils";
import { useFormatters, useTranslation } from "@/i18n/uiCommon";
import { parse as parseYaml } from "yaml";

interface MarkdownRendererProps {
  content: string;
  onLinkClick?: (url: string) => void;
  dangerouslyAllowLocalFiles?: boolean;
}

interface FrontmatterData {
  [key: string]: any;
}

interface FenceBlock {
  openLine: number;
  closeLine: number;
  indent: string;
  infoString: string;
  children: FenceBlock[];
}

function isFrontmatterObject(value: unknown): value is FrontmatterData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses YAML frontmatter from markdown content.
 * Returns the frontmatter data and the content without frontmatter.
 */
function parseFrontmatter(content: string): {
  frontmatter: FrontmatterData | null;
  content: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: null, content };
  }

  try {
    const frontmatterYaml = match[1];
    const mainContent = match[2];
    const parsed: unknown = parseYaml(frontmatterYaml);
    return { frontmatter: isFrontmatterObject(parsed) ? parsed : null, content: mainContent };
  } catch (error) {
    // If YAML parsing fails, return content as-is
    console.warn("Failed to parse frontmatter:", error);
    return { frontmatter: null, content };
  }
}

/**
 * `Date.prototype.toLocaleString()`'s own default parts - numeric date, then the time to the second
 * ("9/22/2026, 3:04:05 PM" in English) - in the UI's language rather than the operating system's.
 */
const FRONTMATTER_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

/**
 * Component to display frontmatter metadata in a styled card.
 */
const FrontmatterDisplay: React.FC<{ data: FrontmatterData }> = memo(({ data }) => {
  const format = useFormatters();
  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Date) {
      return format.dateTime(value, FRONTMATTER_DATE_TIME);
    }
    if (typeof value === "string") {
      // Format ISO dates nicely
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        try {
          const date = new Date(value);
          // An ISO-shaped string that is no real date ("2026-13-45T…") is shown as written.
          if (Number.isNaN(date.getTime())) return value;
          return format.dateTime(date, FRONTMATTER_DATE_TIME);
        } catch {
          return value;
        }
      }
      return value;
    }
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
      <div className="grid gap-2">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex items-start gap-3">
            <span className="font-medium text-muted-foreground text-sm min-w-[100px]">{key}:</span>
            <span className="text-sm flex-1">{formatValue(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

FrontmatterDisplay.displayName = "FrontmatterDisplay";

/**
 * Normalizes nested fenced code blocks so that outer fences use more backticks
 * than inner fences. This fixes CommonMark rendering where nested fences of
 * the same length cause the inner fence to prematurely close the outer one.
 *
 * For example, a markdown block containing a ```csharp block would have its
 * outer fence increased to ```` so the inner ``` doesn't close it.
 */
export function normalizeNestedFences(content: string): string {
  const lines = content.split("\n");
  const fenceRegex = /^(\s{0,3})(`{3,})\s*(.*)/;

  const stack: { line: number; indent: string; infoString: string; children: FenceBlock[] }[] = [];
  const topLevel: FenceBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(fenceRegex);
    if (!match) continue;

    const indent = match[1];
    const infoString = match[3].trim();

    if (stack.length === 0 || infoString) {
      // Opening fence: either top-level or nested (has info string)
      stack.push({ line: i, indent, infoString, children: [] });
    } else {
      // Closing fence (no info string, inside an open block)
      const open = stack.pop()!;
      const block: FenceBlock = {
        openLine: open.line,
        closeLine: i,
        indent: open.indent,
        infoString: open.infoString,
        children: open.children,
      };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(block);
      } else {
        topLevel.push(block);
      }
    }
  }

  // No nesting found — return content unchanged
  if (topLevel.every((b) => b.children.length === 0)) {
    return content;
  }

  function getRequiredBackticks(block: FenceBlock): number {
    if (block.children.length === 0) return 3;
    const maxChild = Math.max(...block.children.map(getRequiredBackticks));
    return maxChild + 1;
  }

  function rewriteBlock(block: FenceBlock) {
    const count = getRequiredBackticks(block);
    const backticks = "`".repeat(count);

    lines[block.openLine] = block.infoString
      ? `${block.indent}${backticks}${block.infoString}`
      : `${block.indent}${backticks}`;
    lines[block.closeLine] = `${block.indent}${backticks}`;

    for (const child of block.children) {
      rewriteBlock(child);
    }
  }

  for (const block of topLevel) {
    rewriteBlock(block);
  }

  return lines.join("\n");
}

const hasContentFeature = (content: string, feature: RegExp): boolean => {
  return feature.test(content);
};

/**
 * `rawHtmlSchema` plus the one element this renderer adds on top of standard markdown:
 * `remarkCustomEmojiPlugin` emits `<emoji name=":shortcode:">` for the `emoji` component mapping
 * below. The GitHub-derived allow-list knows nothing about it, so without this every custom emoji
 * is dropped.
 *
 * `name` also comes off `clobber`: clobbering would rewrite the prop to
 * `user-content-:shortcode:` and the `emojiMap` lookup would miss. `id` stays clobbered — it is
 * the property this component resolves with `document.getElementById` for in-page anchors, and the
 * only one an author can use to clobber a global.
 */
const markdownRendererSchema: SanitizeSchema = {
  ...rawHtmlSchema,
  tagNames: [...(rawHtmlSchema.tagNames ?? []), "emoji"],
  attributes: { ...rawHtmlSchema.attributes, emoji: ["name"] },
  clobber: (rawHtmlSchema.clobber ?? []).filter((property) => property !== "name"),
};

/**
 * Component to render images inside markdown, with zoom overlay support.
 */
interface MarkdownImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  dangerouslyAllowLocalFiles?: boolean;
}

const MarkdownImage: React.FC<MarkdownImageProps> = memo(
  ({ dangerouslyAllowLocalFiles = false, ...props }) => {
    const typography = useTypography();
    const [showOverlay, setShowOverlay] = React.useState(false);
    const src = props.src;

    // Early validation: if src is missing or invalid, don't render anything
    if (!src || typeof src !== "string") {
      return null;
    }

    // Validate and sanitize image URL with optional local file support
    const validatedSrc = validateMediaUrl(src, {
      mediaType: "image",
      dangerouslyAllowLocalFiles,
    });
    if (!validatedSrc) {
      // Invalid URL, don't render image
      return null;
    }

    // Construct the final image source URL
    // For file:// URLs, use them directly (no Ivy host prefix)
    const imageSrc = validatedSrc.match(/^(https?:\/\/|data:|blob:|app:)/i)
      ? validatedSrc
      : (() => {
          const normalizedSrc = validatedSrc.startsWith("/") ? validatedSrc : `/${validatedSrc}`;
          const prefixedSrc = normalizedSrc.startsWith("/ivy/")
            ? normalizedSrc
            : `/ivy${normalizedSrc}`;
          return `${getIvyHost()}${prefixedSrc}`;
        })();

    return (
      <>
        <img
          {...props}
          src={imageSrc}
          alt={props.alt || ""}
          className={cn(
            typography.img,
            "cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          )}
          loading="lazy"
          onClick={() => setShowOverlay(true)}
          onKeyDown={(e) => e.key === "Enter" && setShowOverlay(true)}
          role="button"
          tabIndex={0}
        />
        {showOverlay && (
          <ImageOverlay src={imageSrc} alt={props.alt} onClose={() => setShowOverlay(false)} />
        )}
      </>
    );
  },
  (prevProps, nextProps) =>
    prevProps.src === nextProps.src &&
    prevProps.alt === nextProps.alt &&
    prevProps.dangerouslyAllowLocalFiles === nextProps.dangerouslyAllowLocalFiles,
);

MarkdownImage.displayName = "MarkdownImage";

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onLinkClick,
  dangerouslyAllowLocalFiles = false,
}) => {
  const { t } = useTranslation("uiCommon");
  const typography = useTypography();
  // KaTeX is not imported statically (see `src/lib/math.ts`): 259 kB of maths typesetting in the
  // initial load of every consumer is too much for a feature most markdown does not use. The plugin
  // list below therefore starts without it and is rebuilt once the on-demand import resolves, which
  // is what this subscription is a `useMemo` dependency for.
  const mathReady = useMathReady();
  const contentFeatures = useMemo(
    () => ({
      hasMath: hasContentFeature(content, /(\$\$|\\\(|\\\[|\\begin\{)/),
      hasCodeBlocks: hasContentFeature(content, /```/),
      hasMermaid: hasContentFeature(content, /```mermaid/),
      hasGraphviz: hasContentFeature(content, /```(graphviz|dot)/),
      hasRawHtml: hasRawHtml(content),
    }),
    [content],
  );

  const plugins = useMemo(() => {
    const remarkPlugins: NonNullable<Options["remarkPlugins"]> = [
      remarkGfm,
      remarkGemoji,
      remarkCustomEmojiPlugin,
    ];
    if (contentFeatures.hasMath) remarkPlugins.push([remarkMath, { singleDollarTextMath: false }]);

    const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [];
    // rehype-raw reparses raw HTML into real elements, rehype-sanitize then prunes everything
    // outside the allow-list. Both are skipped when the content has no HTML tag at all.
    if (contentFeatures.hasRawHtml)
      rehypePlugins.push(rehypeRaw, [rehypeSanitize, markdownRendererSchema]);
    // AFTER sanitising, not before: `id` is on the clobber list, so slugs added first would come
    // out as `user-content-<slug>` and the anchor handler's getElementById would never find them.
    rehypePlugins.push(rehypeSlug);
    // KaTeX also has to run after sanitising: its output is classed spans, inline styles and MathML
    // that the allow-list would strip. It is also the one plugin here that is loaded on demand, so
    // when the content has maths but the import has not resolved, this starts it and leaves the
    // plugin out of this pass; `mathReady` brings us back for the pass that includes it.
    if (contentFeatures.hasMath) {
      const rehypeKatex = getRehypeKatex();
      if (rehypeKatex) rehypePlugins.push(rehypeKatex);
      else void loadRehypeKatex();
    }

    return { remarkPlugins, rehypePlugins };
  }, [contentFeatures.hasMath, contentFeatures.hasRawHtml, mathReady]);

  const handleLinkClick = useCallback(
    (href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
      // When local files are enabled, pass file:// URLs directly to onLinkClick
      if (dangerouslyAllowLocalFiles && href.startsWith("file:///")) {
        if (onLinkClick) {
          event.preventDefault();
          onLinkClick(href);
        }
        return;
      }

      // Validate URL to prevent open redirect vulnerabilities
      // validateLinkUrl always returns a string ('#' for invalid URLs)
      // When onLinkClick is registered, allow custom protocols (e.g. plan://)
      // since the handler intercepts navigation rather than the browser
      const validatedHref = validateLinkUrl(href, {
        allowCustomProtocols: !!onLinkClick,
      });
      if (validatedHref === "#") {
        event.preventDefault();
        return;
      }

      // When onLinkClick is registered, intercept ALL link clicks
      // This allows the backend handler to decide how to handle the URL
      if (onLinkClick) {
        event.preventDefault();
        onLinkClick(validatedHref);
      }
    },
    [onLinkClick, dangerouslyAllowLocalFiles],
  );

  // Memoize static components separately (they don't need handleLinkClick)
  const staticComponents = useMemo(
    () => ({
      h1: memo(({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h1 className={typography.h1} {...props}>
          {children}
        </h1>
      )),
      h2: memo(({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h2 className={typography.h2} {...props}>
          {children}
        </h2>
      )),
      h3: memo(({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h3 className={typography.h3} {...props}>
          {children}
        </h3>
      )),
      h4: memo(({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h4 className={typography.h4} {...props}>
          {children}
        </h4>
      )),
      h5: memo(({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h5 className={typography.h5} {...props}>
          {children}
        </h5>
      )),
      h6: memo(({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h6 className={typography.h6} {...props}>
          {children}
        </h6>
      )),
      p: memo(({ children }: { children: React.ReactNode }) => (
        <p className={typography.p}>{children}</p>
      )),
      ul: memo(({ children }: { children: React.ReactNode }) => (
        <ul className={typography.ul}>{children}</ul>
      )),
      ol: memo(({ children }: { children: React.ReactNode }) => (
        <ol className={typography.ol}>{children}</ol>
      )),
      li: memo(({ children, className }: { children: React.ReactNode; className?: string }) => {
        const isTaskItem = className?.includes("task-list-item");
        if (isTaskItem) {
          return <li className={cn(typography.li, "list-none", className)}>{children}</li>;
        }

        const hasBlock = React.Children.toArray(children).some((child) => {
          if (!React.isValidElement(child)) return false;
          const type = child.type;
          if (typeof type === "string") {
            return [
              "p",
              "ul",
              "ol",
              "pre",
              "blockquote",
              "table",
              "div",
              "h1",
              "h2",
              "h3",
              "h4",
              "h5",
              "h6",
            ].includes(type);
          }
          const node = (child.props as any)?.node;
          if (node) {
            const tagName = node.tagName || (node.type === "paragraph" ? "p" : null);
            if (tagName) {
              return [
                "p",
                "ul",
                "ol",
                "pre",
                "blockquote",
                "table",
                "div",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
              ].includes(tagName);
            }
          }
          return false;
        });

        return (
          <li className={cn(typography.li, className)}>
            {hasBlock ? <div className={typography.liContent}>{children}</div> : children}
          </li>
        );
      }),
      strong: memo(({ children }: { children: React.ReactNode }) => (
        <strong className={typography.strong}>{children}</strong>
      )),
      em: memo(({ children }: { children: React.ReactNode }) => (
        <em className={typography.em}>{children}</em>
      )),
      pre: memo(({ children }: { children: React.ReactNode }) => <>{children}</>),
      blockquote: memo(({ children }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => {
        const alert = parseGitHubAlert(children);
        if (alert) {
          const style = githubAlertStyles[alert.type];
          return (
            <div
              className={cn(
                "flex items-start text-large-body rounded-box border transition-colors relative",
                "p-4 my-4",
                style.className,
              )}
              role="alert"
            >
              <Icon
                name={style.icon}
                size="24"
                className={cn("mr-3.5 shrink-0 opacity-90", style.iconColor)}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <div className="font-medium mb-1 leading-6">{githubAlertTitle(alert.type)}</div>
                <div className="text-sm opacity-90 leading-relaxed [&_p]:text-sm [&_p]:mb-0">
                  {alert.content}
                </div>
              </div>
            </div>
          );
        }
        return <blockquote className={typography.blockquote}>{children}</blockquote>;
      }),
      table: memo(({ children }: { children: React.ReactNode }) => (
        <table className={typography.table}>{children}</table>
      )),
      thead: memo(({ children }: { children: React.ReactNode }) => (
        <thead className="bg-muted">{children}</thead>
      )),
      tr: memo(({ children }: { children: React.ReactNode }) => (
        <tr className="border border-border">{children}</tr>
      )),
      th: memo(({ children }: { children: React.ReactNode }) => (
        <th className={typography.th}>{children}</th>
      )),
      td: memo(({ children }: { children: React.ReactNode }) => (
        <td className={typography.td}>{children}</td>
      )),
      img: memo((props: React.ImgHTMLAttributes<HTMLImageElement>) => (
        <MarkdownImage {...props} dangerouslyAllowLocalFiles={dangerouslyAllowLocalFiles} />
      )),
      hr: memo((props: React.HTMLAttributes<HTMLHRElement>) => (
        <hr className={typography.hr} {...props} />
      )),
      input: memo(({ type, checked, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => {
        if (type === "checkbox") {
          return (
            <input
              type="checkbox"
              checked={checked}
              aria-label={checked ? t("markdown.taskCompleted") : t("markdown.taskPending")}
              {...props}
            />
          );
        }
        return <input type={type} checked={checked} {...props} />;
      }),
      details: memo(({ children, ...props }: React.DetailsHTMLAttributes<HTMLDetailsElement>) => (
        <details className={cn(typography.details, "group")} {...props}>
          {children}
        </details>
      )),
      summary: memo(({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
        <summary className={typography.summary} {...props}>
          <div className="flex items-center gap-2">
            <svg
              className="size-4 shrink-0 transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {children}
          </div>
        </summary>
      )),
    }),
    [
      typography.h1,
      typography.h2,
      typography.h3,
      typography.h4,
      typography.h5,
      typography.h6,
      typography.p,
      typography.ul,
      typography.ol,
      typography.li,
      typography.liContent,
      typography.strong,
      typography.em,
      typography.blockquote,
      typography.table,
      typography.td,
      typography.th,
      typography.img,
      typography.hr,
      typography.details,
      typography.summary,
      dangerouslyAllowLocalFiles,
      // The alert headings and the task checkboxes' labels are translated inside these renderers.
      t,
    ],
  );

  // Memoize code component separately (depends on contentFeatures.hasCodeBlocks and hasMermaid)
  const codeComponent = useMemo(
    () => ({
      code: memo((props: React.ComponentProps<"code">) => {
        const { children, className } = props;
        const node = (props as any).node;
        const isInPre = node?.parent?.tagName === "pre";
        const inline = isInPre ? false : !className && !extractTextContent(children).includes("\n");

        // Detect Icons.X pattern in inline code
        if (inline) {
          const text = extractTextContent(children);
          const iconMatch = text.match(/^Icons\.([A-Z][a-zA-Z0-9]*)$/);
          if (iconMatch) {
            return (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25em" }}>
                <code className={typography.code}>{children}</code>
                <Icon name={iconMatch[1]} size="1em" />
              </span>
            );
          }
        }

        return (
          <MarkdownCodeBlock
            className={className}
            inline={inline}
            hasCodeBlocks={contentFeatures.hasCodeBlocks}
            hasMermaid={contentFeatures.hasMermaid}
            hasGraphviz={contentFeatures.hasGraphviz}
          >
            {children}
          </MarkdownCodeBlock>
        );
      }),
    }),
    [
      contentFeatures.hasCodeBlocks,
      contentFeatures.hasMermaid,
      contentFeatures.hasGraphviz,
      typography.code,
    ],
  );

  // Memoize link component separately (depends on handleLinkClick)
  const linkComponent = useMemo(
    () => ({
      a: memo(
        ({ children, href, title, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
          // Popover links: [text](## "popover content")
          if (href === "##" && title) {
            return <PopoverLink content={title}>{children}</PopoverLink>;
          }

          // When local files are enabled, allow file:// URLs to render as clickable links
          const isLocalFileUrl = dangerouslyAllowLocalFiles && href?.startsWith("file:///");

          const safeHref = isLocalFileUrl
            ? href!
            : validateLinkUrl(href, { allowCustomProtocols: !!onLinkClick });
          if (safeHref === "#") {
            return <span {...props}>{children}</span>;
          }

          // Use helper functions for URL type detection
          const isExternalLink = isExternalUrl(safeHref);
          const isAnchor = isAnchorLink(safeHref);
          const isApp = isAppProtocol(safeHref);

          // Convert app:// URLs to regular paths for href attribute
          let hrefForNavigation = safeHref;
          if (isApp) {
            // Use the utility function to convert app:// URLs, preserving shell=false
            hrefForNavigation = convertAppUrlToPath(safeHref);
          }

          return (
            <a
              {...props}
              className="text-primary underline underline-offset-[3px] brightness-90 hover:brightness-100"
              href={hrefForNavigation}
              target={isExternalLink && !onLinkClick ? "_blank" : undefined}
              rel={isExternalLink && !onLinkClick ? "noopener noreferrer" : undefined}
              onClick={
                isAnchor
                  ? (e) => {
                      e.preventDefault();
                      // Extract anchor ID by removing the '#' prefix
                      const targetId = extractAnchorId(safeHref);
                      if (targetId) {
                        // Small delay to ensure content is rendered
                        requestAnimationFrame(() => {
                          const targetElement = document.getElementById(targetId);
                          if (targetElement) {
                            targetElement.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                            // Update URL hash
                            window.history.replaceState(null, "", `#${targetId}`);
                          }
                        });
                      }
                    }
                  : onLinkClick
                    ? (e) => handleLinkClick(safeHref, e)
                    : undefined
              }
            >
              {children}
            </a>
          );
        },
      ),
    }),
    [handleLinkClick, dangerouslyAllowLocalFiles],
  );

  const components = useMemo(
    () => ({
      ...staticComponents,
      ...codeComponent,
      ...linkComponent,
    }),
    [staticComponents, codeComponent, linkComponent],
  );
  // This is useful to declare emoji as a new type of valid markdown component
  type MarkdownComponents = Components & {
    emoji?: React.FC<{ name: string }>;
  };

  // add the components that use memo and the ones that don't in a single variable of the extended type we just created
  const componentsParams: MarkdownComponents = {
    ...(components as React.ComponentProps<typeof ReactMarkdown>["components"]),

    // ReactMarkdown will execute this when he finds an image node with hName emoji
    emoji: ({ name }: { name: string }) => <CustomEmoji name={name} />,
  };

  const { frontmatter, content: contentWithoutFrontmatter } = useMemo(
    () => parseFrontmatter(content),
    [content],
  );

  const normalizedContent = useMemo(
    () => normalizeNestedFences(contentWithoutFrontmatter),
    [contentWithoutFrontmatter],
  );

  const urlTransform = useCallback(
    (url: string, key: string) => {
      // Preserve popover link marker
      if (url === "##") {
        return url;
      }
      if (url.startsWith("app://")) {
        return url;
      }
      // Allow file:// URLs and Windows paths when local files are enabled
      if (
        dangerouslyAllowLocalFiles &&
        (url.startsWith("file://") || /^[a-zA-Z]:[\\/]/.test(url))
      ) {
        // For links (href), preserve file:// URL for onLinkClick to handle
        if (key === "href") {
          if (/^[a-zA-Z]:[\\/]/.test(url)) {
            const normalized = url.replace(/\\/g, "/");
            return `file:///${normalized}`;
          }
          return url;
        }
        // For images (src), use local-file proxy
        if (isLocalFilesEnabled()) {
          // Server supports local file proxy - use /ivy/local-file endpoint
          let filePath: string;
          if (url.startsWith("file:///")) {
            filePath = decodeURIComponent(url.slice(8));
          } else if (url.startsWith("file://")) {
            filePath = decodeURIComponent(url.slice(7));
          } else {
            filePath = url.replace(/\\/g, "/");
          }
          return `/ivy/local-file?path=${encodeURIComponent(filePath)}`;
        }
        // Fallback: pass file:// URL through (browser will likely block it)
        if (/^[a-zA-Z]:[\\/]/.test(url)) {
          const normalized = url.replace(/\\/g, "/");
          return `file:///${normalized}`;
        }
        return url;
      }
      // Validate URL before transforming to prevent open redirect vulnerabilities
      // validateLinkUrl always returns a string ('#' for invalid URLs)
      const validatedUrl = validateLinkUrl(url);
      // defaultUrlTransform handles all valid URLs, and '#' for invalid URLs
      return defaultUrlTransform(validatedUrl);
    },
    [dangerouslyAllowLocalFiles],
  );

  // remark-gfm's footnotes section: its sr-only heading and each back-reference link's label, which
  // mdast-util-to-hast writes in English ("Footnotes", "Back to reference 1", "… 1-2") by default.
  const remarkRehypeOptions = useMemo<NonNullable<Options["remarkRehypeOptions"]>>(
    () => ({
      footnoteLabel: t("markdown.footnotes.label"),
      footnoteBackLabel: (referenceIndex: number, rereferenceIndex: number) =>
        rereferenceIndex > 1
          ? t("markdown.footnotes.backToReferenceRepeat", {
              ref: referenceIndex + 1,
              reref: rereferenceIndex,
            })
          : t("markdown.footnotes.backToReference", { ref: referenceIndex + 1 }),
    }),
    [t],
  );

  return (
    <>
      {frontmatter && <FrontmatterDisplay data={frontmatter} />}
      <ReactMarkdown
        components={{
          ...componentsParams,
        }}
        remarkPlugins={plugins.remarkPlugins}
        rehypePlugins={plugins.rehypePlugins}
        remarkRehypeOptions={remarkRehypeOptions}
        urlTransform={urlTransform}
      >
        {normalizedContent}
      </ReactMarkdown>
    </>
  );
};

export { MarkdownRenderer };
export type { MarkdownRendererProps };
