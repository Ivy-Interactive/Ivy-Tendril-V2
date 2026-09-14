import { memo } from "react";
import CopyToClipboardButton from "./CopyToClipboardButton";
import { renderGraphviz } from "@/lib/diagram";
import { useDiagramRender } from "@/hooks/use-diagram-render";

interface GraphvizRendererProps {
  content: string;
}

const GraphvizRenderer = memo(({ content }: GraphvizRendererProps) => {
  const { elementRef, isLoading, error } = useDiagramRender(content, renderGraphviz);

  if (error) {
    return (
      <div className="rounded-md border border-destructive bg-destructive/10 p-3">
        <div className="flex items-center gap-2 text-destructive text-sm font-medium">
          <svg
            className="size-4 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <span>Invalid Graphviz DOT syntax</span>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
        <CopyToClipboardButton textToCopy={content} />
      </div>
      <div className="graphviz-container rounded-md border bg-background p-4 overflow-x-auto slim-scrollbar">
        {isLoading && (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <div className="animate-spin rounded-full size-6 border-b-2 border-primary"></div>
            <span className="ml-2 text-sm">Loading diagram...</span>
          </div>
        )}
        <div
          ref={elementRef}
          className="graphviz-diagram"
          style={{ minHeight: isLoading ? "100px" : "auto" }}
        />
      </div>
    </div>
  );
});

GraphvizRenderer.displayName = "GraphvizRenderer";

export { GraphvizRenderer };
export type { GraphvizRendererProps };
export default GraphvizRenderer;
