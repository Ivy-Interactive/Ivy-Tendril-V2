import { navigate } from "../lib/router";

interface NotFoundProps {
  route: string;
  /** Where "Go to the introduction" sends the reader — the first page of the first section. */
  homeRoute: string;
}

export function NotFound({ route, homeRoute }: NotFoundProps) {
  return (
    <div className="docs-article">
      <h1 className="mb-3 text-4xl font-semibold">Page not found</h1>
      <p className="mb-6 text-lg leading-relaxed text-muted-foreground">
        Nothing is published at <code className="rounded bg-muted px-1 py-0.5 font-mono">{route}</code>.
      </p>
      <p className="text-base leading-relaxed">
        Use the sidebar, press <kbd className="rounded border border-border px-1 font-mono">⌘K</kbd> to
        search, or{" "}
        <a
          href={homeRoute}
          onClick={(event) => {
            event.preventDefault();
            navigate(homeRoute);
          }}
          className="text-primary underline underline-offset-[3px]"
        >
          start from the introduction
        </a>
        .
      </p>
    </div>
  );
}
