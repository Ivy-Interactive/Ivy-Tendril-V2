import { useEffect, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DialogDescription,
  DialogTitle,
} from "@ivy-interactive/components/ui";
import type { DocPage } from "../lib/page";
import type { DocsSearchIndex, SearchHit } from "../lib/search";
import { navigate } from "../lib/router";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: Iterable<DocPage>;
}

/**
 * `⌘K` / `Ctrl+K` full-text search.
 *
 * The index — and MiniSearch itself — arrive through a dynamic import on first open, so a reader who
 * never searches never downloads it.
 */
export function SearchDialog({ open, onOpenChange, pages }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<DocsSearchIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  // The in-flight guard has to live in a ref, not in `loading`: a state flag in the effect's
  // dependency list re-runs the effect the moment it is set, and the cleanup of that first run would
  // cancel the import it just started — leaving the dialog on "Building the index…" forever.
  const loadingRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || index || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    void import("../lib/search")
      .then(({ buildSearchIndex }) => {
        setIndex(buildSearchIndex(pagesRef.current));
      })
      .catch((error: unknown) => {
        // Let the next open try again — a chunk that failed to fetch usually succeeds on a retry.
        loadingRef.current = false;
        console.error("[tendril-docs] Failed to load the search index.", error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, index]);

  const hits: SearchHit[] = index && query.trim() ? index.search(query) : [];
  const grouped = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const bucket = grouped.get(hit.section);
    if (bucket) bucket.push(hit);
    else grouped.set(hit.section, [hit]);
  }

  const select = (route: string) => {
    onOpenChange(false);
    setQuery("");
    navigate(route);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      {/*
       * `CommandDialog` renders a bare `DialogContent`, and Radix logs an accessibility error when
       * the content has no title and no description. Both are for screen readers only; the visible
       * label is the input's placeholder.
       */}
      <DialogTitle className="sr-only">Search the documentation</DialogTitle>
      <DialogDescription className="sr-only">
        Type a few words to search every page. Use the arrow keys to choose a result.
      </DialogDescription>
      <CommandInput
        placeholder="Search the documentation…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {query.trim().length === 0 ? (
          <CommandEmpty>Type to search every page.</CommandEmpty>
        ) : hits.length === 0 ? (
          <CommandEmpty>{loading ? "Building the index…" : "No matches."}</CommandEmpty>
        ) : null}

        {[...grouped.entries()].map(([section, sectionHits]) => (
          <CommandGroup key={section} heading={section}>
            {sectionHits.map((hit) => (
              <CommandItem
                key={hit.route}
                // Ranking is MiniSearch's job, not cmdk's. Prefixing the value with the live query
                // keeps cmdk's own fuzzy filter from dropping a hit that MiniSearch matched on a
                // frontmatter searchHint or a stemmed term the visible text never contains.
                value={`${query} ${hit.route}`}
                onSelect={() => select(hit.route)}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="text-sm font-medium">{hit.title}</span>
                {hit.snippet && (
                  <span className="line-clamp-2 text-xs text-muted-foreground">{hit.snippet}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
