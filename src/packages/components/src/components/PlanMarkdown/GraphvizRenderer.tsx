import { memo } from "react";
import { renderGraphviz } from "@/lib/diagram";
import { useDiagramRender } from "@/hooks/use-diagram-render";

interface GraphvizRendererProps {
  content: string;
}

export const GraphvizRenderer = memo(({ content }: GraphvizRendererProps) => {
  const { elementRef, isLoading, error } = useDiagramRender(content, renderGraphviz);

  if (error) {
    return (
      <div className="pmv-diagram-error">
        <span>Invalid Graphviz DOT syntax</span>
      </div>
    );
  }

  return (
    <div className="pmv-diagram-container">
      {isLoading && (
        <div className="pmv-diagram-loading">
          <span>Loading diagram...</span>
        </div>
      )}
      <div ref={elementRef} style={{ minHeight: isLoading ? "100px" : "auto" }} />
    </div>
  );
});

GraphvizRenderer.displayName = "GraphvizRenderer";
