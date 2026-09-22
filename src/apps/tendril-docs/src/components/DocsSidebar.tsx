import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { iconFor } from "../lib/icons";
import { flattenNavRoutes, type NavSection } from "../lib/nav";
import { navigate, toAppHref } from "../lib/router";

interface DocsSidebarProps {
  sections: NavSection[];
  /** Currently displayed route, used for the active marker and to auto-open its section. */
  activeRoute: string;
  /** Called after a successful in-page navigation, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}

function NavLink({
  href,
  label,
  active,
  depth,
  onNavigate,
}: {
  href: string;
  label: string;
  active: boolean;
  depth: number;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={toAppHref(href)}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(href);
        onNavigate?.();
      }}
      className={cn(
        "flex h-7 min-w-0 items-center rounded-md px-2 text-sm transition-colors",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
      style={{ paddingInlineStart: `${0.5 + depth * 0.75}rem` }}
    >
      <span className="truncate">{label}</span>
    </a>
  );
}

function Section({
  section,
  activeRoute,
  depth,
  onNavigate,
}: {
  section: NavSection;
  activeRoute: string;
  depth: number;
  onNavigate?: () => void;
}) {
  const ownRoutes = useMemo(() => new Set(flattenNavRoutes([section])), [section]);
  const containsActive = ownRoutes.has(activeRoute);
  // `groupExpanded` is the author's default; browsing wins over it, and being inside the section
  // always wins over both.
  const [open, setOpen] = useState(section.groupExpanded || containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  const Glyph = iconFor(section.icon);

  return (
    <li>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${section.title}`}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
            aria-hidden="true"
          />
        </button>
        <a
          href={toAppHref(section.route)}
          aria-current={activeRoute === section.route ? "page" : undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            navigate(section.route);
            onNavigate?.();
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors",
            activeRoute === section.route
              ? "bg-secondary text-foreground"
              : "text-foreground/90 hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          <Glyph className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{section.title}</span>
        </a>
      </div>

      {open && (section.pages.length > 0 || section.sections.length > 0) && (
        <ul className="ms-3.5 my-0.5 flex flex-col gap-0.5 border-l border-border/60 ps-2.5">
          {section.pages.map((page) => (
            <li key={page.route}>
              <NavLink
                href={page.route}
                label={page.title}
                active={activeRoute === page.route}
                depth={depth}
                onNavigate={onNavigate}
              />
            </li>
          ))}
          {section.sections.map((child) => (
            <Section
              key={child.route}
              section={child}
              activeRoute={activeRoute}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The numbered-section navigation.
 *
 * Everything here comes from `buildNavTree`, i.e. from the shape of `content/` — there is no
 * hand-maintained navigation manifest to drift out of sync, which is what `nav-structure.test.ts`
 * pins down.
 */
export function DocsSidebar({ sections, activeRoute, onNavigate }: DocsSidebarProps) {
  return (
    <nav aria-label="Documentation sections" className="text-sm">
      <ul className="flex flex-col gap-3">
        {sections.map((section) => (
          <Section
            key={section.route}
            section={section}
            activeRoute={activeRoute}
            depth={0}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </nav>
  );
}
